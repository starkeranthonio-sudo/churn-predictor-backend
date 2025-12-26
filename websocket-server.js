require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Kafka } = require('kafkajs');
const cors = require('cors');
const AnalyticsEngine = require('./analytics-engine');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
const gmailReader = require('./gmail-reader-service');
const messageAnalyzer = require('./message-analyzer-service');
const autoResponse = require('./auto-response-service');
const adminAlert = require('./admin-alert-service');
const vertexAI = require('./vertex-ai-service');

// Initialisation Firebase Admin
try {
  let serviceAccount;
  
  // En production (Render), décoder depuis variable d'environnement
  if (process.env.FIREBASE_CREDENTIALS) {
    const decoded = Buffer.from(process.env.FIREBASE_CREDENTIALS, 'base64').toString();
    serviceAccount = JSON.parse(decoded);
    console.log('✅ Firebase credentials chargées depuis env var');
  } else {
    // En local, lire le fichier
    serviceAccount = require('./firebase-service-account.json');
    console.log('✅ Firebase credentials chargées depuis fichier');
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin initialisé');
} catch (error) {
  console.log('⚠️ Firebase Admin non configuré:', error.message);
}

const gmailService = require('./gmail-oauth-service');

// Configuration OAuth
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/gmail/callback';

gmailService.init(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI);
const firestoreDB = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// KAFKA CONFIGURATION
const kafka = new Kafka({
  clientId: 'websocket-server',
  brokers: [process.env.CONFLUENT_BOOTSTRAP_SERVER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.CONFLUENT_API_KEY,
    password: process.env.CONFLUENT_API_SECRET,
  },
});

const consumer = kafka.consumer({ groupId: 'websocket-group' });
const producer = kafka.producer();

// STOCKAGE EN MÉMOIRE
let messagesHistory = [];
let alertsHistory = [];
const analytics = new AnalyticsEngine();

// ========================================
// WEBSOCKET
// ========================================
wss.on('connection', (ws) => {
  console.log('🔌 Client connecté au WebSocket');
  ws.send(JSON.stringify({
    type: 'history',
    messages: messagesHistory.slice(-20),
    alerts: alertsHistory.slice(-10)
  }));
  ws.on('close', () => console.log('❌ Client déconnecté'));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ========================================
// KAFKA CONSUMER
// ========================================
async function startKafkaConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'churn-scores', fromBeginning: false });
  await consumer.subscribe({ topic: 'critical-alerts', fromBeginning: false });
  console.log('👂 Écoute Kafka topics: churn-scores, critical-alerts');

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const data = JSON.parse(message.value.toString());
      
      if (topic === 'churn-scores') {
        console.log(`📊 Score reçu: ${data.score} pour ${data.clientId}`);
        messagesHistory.push(data);
        
        try {
          await firestoreDB.collection('messages').add({
            clientId: data.clientId,
            texte: data.texte,
            score: data.score,
            sentiment: data.sentiment,
            raisons: data.raisons || [],
            action: data.action || '',
            motsCles: data.motsCles || [],
            reponsesSuggerees: data.reponsesSuggerees || [],
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`💾 Message sauvegardé dans Firebase`);
        } catch (error) {
          console.error('❌ Erreur Firebase:', error.message);
        }
        
        if (messagesHistory.length > 50) messagesHistory.shift();
        analytics.ajouterMessage(data);

        broadcast({ type: 'churn-score', data: data });
        broadcast({
          type: 'analytics-update',
          data: {
            stats: analytics.getStatistiques(),
            graphique: analytics.getDonneesGraphique(),
            insights: analytics.insights,
            prediction: analytics.predireProchainScore(),
            heatmap: analytics.getHeatmapMotsCles()
          }
        });
      }

      if (topic === 'critical-alerts') {
        console.log(`🚨 ALERTE: ${data.clientId} - Score ${data.score}`);
        alertsHistory.push(data);
        if (alertsHistory.length > 20) alertsHistory.shift();
        broadcast({ type: 'critical-alert', data: data });
      }
    },
  });
}

async function analyzeMessageWithVertexAI(texte, clientId) {
  try {
    const messagesSnapshot = await firestoreDB.collection('messages')
      .where('clientId', '==', clientId)
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    const historique = [];
    messagesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.texte) {
        historique.push({
          texte: data.texte,
          score: data.score || 'non analysé',
          date: data.timestamp
        });
      }
    });

    const clientDoc = await firestoreDB.collection('clients').doc(clientId).get();
    const clientData = clientDoc.exists ? clientDoc.data() : {};

    // Utiliser Vertex AI + Gemini au lieu d'OpenAI
    const result = await vertexAI.analyzeMessage(texte, clientId, historique, clientData);
    
    return result;

  } catch (error) {
    console.error('❌ Erreur Vertex AI:', error.message);
    throw error;
  }
}


// ========================================
// API REST
// ========================================
app.post('/api/send-message', async (req, res) => {
  const { clientId, texte } = req.body;
  if (!clientId || !texte) {
    return res.status(400).json({ error: 'clientId et texte requis' });
  }
  try {
    await producer.send({
      topic: 'messages-entrants',
      messages: [{
        key: clientId,
        value: JSON.stringify({ clientId, texte, timestamp: new Date().toISOString() }),
      }],
    });
    console.log(`📤 Message envoyé: "${texte}"`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', (req, res) => {
  res.json({
    messages: messagesHistory.slice(-20),
    alerts: alertsHistory.slice(-10)
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========================================
// OAUTH GMAIL
// ========================================
app.get('/auth/gmail', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).send('User ID requis');
  const authUrl = gmailService.getAuthUrl();
  res.cookie('pendingUserId', userId, { httpOnly: true, maxAge: 600000 });
  res.redirect(authUrl);
});

app.get('/auth/gmail/callback', async (req, res) => {
  const code = req.query.code;
  const userId = req.cookies.pendingUserId;
  if (!code || !userId) return res.send('<h1>❌ Erreur</h1>');

  try {
    const tokens = await gmailService.getTokensFromCode(code);
    await gmailService.saveTokens(userId, tokens);
    res.send(`<html><head><style>body{font-family:sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.success{background:white;padding:48px;border-radius:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)}h1{color:#10b981;margin-bottom:16px}p{color:#6b7280;margin-bottom:24px}button{background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer}</style></head><body><div class="success"><h1>✅ Gmail connecté !</h1><p>Vous pouvez maintenant envoyer des emails.</p><button onclick="window.close()">Fermer</button></div><script>setTimeout(()=>{if(window.opener){window.opener.postMessage({type:'gmail-connected'},'*');window.close()}},2000)</script></body></html>`);
  } catch (error) {
    res.send('<h1>❌ Erreur OAuth</h1>');
  }
});

app.get('/api/gmail/status', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID requis' });
  try {
    const isConnected = await gmailService.isConnected(userId);
    res.json({ connected: isConnected });
  } catch (error) {
    res.json({ connected: false });
  }
});

app.post('/api/gmail/disconnect', async (req, res) => {
  try {
    await gmailService.disconnect(req.body.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/send-email', async (req, res) => {
  const { userId, to, subject, body } = req.body;
  if (!userId || !to || !subject || !body) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }
  try {
    await gmailService.sendEmail(userId, to, subject, body);
    res.json({ success: true, message: 'Email envoyé' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DÉMARRAGE
// ========================================
async function start() {
  await producer.connect();
  await startKafkaConsumer();

  // Démarrer services automatiques
  setTimeout(async () => {
    try {
      const tokensSnapshot = await firestoreDB.collection('gmail_tokens').limit(1).get();
      
      if (!tokensSnapshot.empty) {
        const userId = tokensSnapshot.docs[0].id;
        console.log(`\n🚀 Démarrage services auto pour user: ${userId}`);
        
        // Récupérer email admin
        const userDoc = await firestoreDB.collection('users').doc(userId).get();
        const adminEmail = userDoc.exists ? userDoc.data().email : null;

        // Initialiser services
        // Initialiser Vertex AI
// Initialiser Vertex AI avec failover multi-projets
const projectConfigs = [
  {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_1,
    credentialsPath: './credentials/vertex-project1.json'
  },
  {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_2,
    credentialsPath: './credentials/vertex-project2.json'
  }
];
vertexAI.init(projectConfigs);
        autoResponse.init(userId);
        adminAlert.init(userId, adminEmail);
        
        // Wrapper pour analyzer avec auto-response et alertes
        const originalAnalyze = messageAnalyzer.analyzeMessage.bind(messageAnalyzer);
        messageAnalyzer.analyzeMessage = async function(doc) {
          const result = await originalAnalyze(doc);
          if (result) {
            const { messageId, data } = result;
            await autoResponse.checkAndSend(messageId, data);
            await adminAlert.checkAndAlert(messageId, data);
          }
          return result;
        };

        gmailReader.start(userId, 30);
        messageAnalyzer.start(analyzeMessageWithVertexAI, 5);
        
      } else {
        console.log('⚠️ Aucun Gmail - Services auto non démarrés');
        console.log('💡 Connectez Gmail dans Paramètres');
      }
    } catch (error) {
      console.error('❌ Erreur services:', error.message);
    }
  }, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Serveur démarré:`);
  console.log(`   - WebSocket: ws://localhost:${PORT}`);
  console.log(`   - API: http://localhost:${PORT}\n`);
});
}

start().catch(console.error);

process.on('SIGTERM', async () => {
  await consumer.disconnect();
  await producer.disconnect();
  server.close();
  process.exit(0);
});