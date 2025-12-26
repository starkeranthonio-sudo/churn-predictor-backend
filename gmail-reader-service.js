const { google } = require('googleapis');
const gmailService = require('./gmail-oauth-service');

class GmailReaderService {
  constructor() {
    this.db = null; // Sera initialisé plus tard
    this.isRunning = false;
    this.lastCheckTime = null;
  }

  // Initialiser Firestore
  initDB() {
    if (!this.db) {
      const admin = require('firebase-admin');
      this.db = admin.firestore();
    }
  }

  // Démarrer la lecture automatique
  start(userId, intervalSeconds = 30) {
    if (this.isRunning) {
      console.log('⚠️ Gmail Reader déjà en cours');
      return;
    }

    this.isRunning = true;
    this.userId = userId;
    console.log(`✅ Gmail Reader démarré (vérification toutes les ${intervalSeconds}s)`);

    // Premier check immédiat
    this.checkNewEmails();

    // Puis check périodique
    this.interval = setInterval(() => {
      this.checkNewEmails();
    }, intervalSeconds * 1000);
  }

  // Arrêter la lecture
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.isRunning = false;
      console.log('🛑 Gmail Reader arrêté');
    }
  }

  // Vérifier les nouveaux emails
  async checkNewEmails() {
    try {
      // Récupérer les tokens OAuth
      const tokens = await gmailService.getTokens(this.userId);
      
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expiry_date: tokens.expiryDate
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Chercher emails non lus dans INBOX
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox',
        maxResults: 10
      });

      if (!response.data.messages || response.data.messages.length === 0) {
        console.log('📭 Aucun nouveau email');
        return;
      }

      console.log(`📬 ${response.data.messages.length} nouveaux emails détectés`);

      // Traiter chaque email
      for (const message of response.data.messages) {
        await this.processEmail(gmail, message.id);
      }

    } catch (error) {
      console.error('❌ Erreur Gmail Reader:', error.message);
    }
  }

  // Traiter un email
  async processEmail(gmail, messageId) {
    try {
      this.initDB(); // Initialiser Firestore
      
      // Récupérer les détails de l'email
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      // Extraire les infos
      const headers = message.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      
      // Extraire email et nom
      const emailMatch = from.match(/<(.+?)>/);
      const senderEmail = emailMatch ? emailMatch[1] : from;
      const senderName = from.replace(/<.+?>/, '').trim() || senderEmail;

      // Extraire le corps du message
      let bodyText = '';
      if (message.data.payload.body.data) {
        bodyText = Buffer.from(message.data.payload.body.data, 'base64').toString();
      } else if (message.data.payload.parts) {
        const textPart = message.data.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart && textPart.body.data) {
          bodyText = Buffer.from(textPart.body.data, 'base64').toString();
        }
      }

      // Nettoyer le texte
      // Nettoyer le texte de manière approfondie
bodyText = bodyText
  // Enlever balises HTML
  .replace(/<[^>]*>/g, '')
  // Enlever URLs
  .replace(/https?:\/\/[^\s]+/g, '')
  // Enlever emails
  .replace(/[\w\.-]+@[\w\.-]+\.\w+/g, '')
  // Enlever caractères spéciaux répétés
  .replace(/[^\w\s,.!?àâäéèêëïîôùûüÿæœç-]/gi, ' ')
  // Enlever espaces multiples
  .replace(/\s+/g, ' ')
  // Enlever lignes vides
  .replace(/\n\s*\n/g, '\n')
  .trim();

// Garder seulement le texte pertinent (pas les footers, etc.)
const lines = bodyText.split('\n');
const meaningfulLines = lines.filter(line => {
  const l = line.trim();
  // Ignorer lignes trop courtes ou qui ressemblent à du HTML/spam
  return l.length > 10 && 
         !l.startsWith('Consultez') && 
         !l.startsWith('Cliquez') &&
         !l.startsWith('Unsubscribe') &&
         !l.includes('version en ligne');
});

bodyText = meaningfulLines.slice(0, 10).join(' ').substring(0, 800);

// Si le texte est vide ou trop court, ignorer cet email
if (bodyText.length < 20) {
  console.log('⚠️ Message trop court ou vide, ignoré');
  return;
}

      console.log(`\n📧 Email de: ${senderName} (${senderEmail})`);
      console.log(`📝 Sujet: ${subject}`);
      console.log(`💬 Message: ${bodyText.substring(0, 100)}...`);

      const admin = require('firebase-admin');

      // Vérifier si le client existe déjà
      let clientId = null;
      const clientsSnapshot = await this.db.collection('clients')
        .where('email', '==', senderEmail)
        .limit(1)
        .get();

      if (clientsSnapshot.empty) {
        // Créer un nouveau client
        const clientRef = await this.db.collection('clients').add({
          name: senderName,
          email: senderEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: 'gmail-reader',
          source: 'email'
        });
        clientId = clientRef.id;
        console.log(`✅ Nouveau client créé: ${clientId}`);
      } else {
        clientId = clientsSnapshot.docs[0].id;
        console.log(`✅ Client existant: ${clientId}`);
      }

      // Créer le message dans Firebase (sans analyse pour l'instant)
      await this.db.collection('messages').add({
        clientId: clientId,
        texte: bodyText,
        subject: subject,
        fromEmail: senderEmail,
        fromName: senderName,
        gmailMessageId: messageId,
        needsAnalysis: true, // Flag pour analyse différée
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ Message enregistré pour analyse`);

      // Marquer comme lu
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });

      console.log(`✅ Email marqué comme lu\n`);

    } catch (error) {
      console.error('❌ Erreur traitement email:', error.message);
    }
  }
}

module.exports = new GmailReaderService();