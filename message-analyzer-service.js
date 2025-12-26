class MessageAnalyzerService {
  constructor() {
    this.db = null; // Sera initialisé plus tard
    this.isRunning = false;
  }

  // Initialiser Firestore
  initDB() {
    if (!this.db) {
      const admin = require('firebase-admin');
      this.db = admin.firestore();
    }
  }

  // Démarrer l'analyseur
  start(analyzeFunction, intervalSeconds = 5) {
    if (this.isRunning) {
      console.log('⚠️ Analyzer déjà en cours');
      return;
    }

    this.isRunning = true;
    this.analyzeFunction = analyzeFunction;
    console.log(`✅ Message Analyzer démarré`);

    // Check périodique
    this.interval = setInterval(() => {
      this.processQueue();
    }, intervalSeconds * 1000);
  }

  // Arrêter
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.isRunning = false;
      console.log('🛑 Message Analyzer arrêté');
    }
  }

  // Traiter la file d'attente
  async processQueue() {
    try {
      this.initDB(); // Initialiser Firestore
      
      // Chercher messages non analysés
      const snapshot = await this.db.collection('messages')
        .where('needsAnalysis', '==', true)
        .limit(5)
        .get();

      if (snapshot.empty) {
        return;
      }

      console.log(`\n🔍 ${snapshot.size} messages à analyser`);

      for (const doc of snapshot.docs) {
        await this.analyzeMessage(doc);
      }

    } catch (error) {
      console.error('❌ Erreur processQueue:', error.message);
    }
  }

  // Analyser un message
  async analyzeMessage(doc) {
    try {
      this.initDB(); // Initialiser Firestore
      
      const data = doc.data();
      console.log(`\n🤖 Analyse du message: "${data.texte.substring(0, 50)}..."`);

      // Appeler la fonction d'analyse (passée en paramètre)
      const result = await this.analyzeFunction(data.texte, data.clientId);

      const admin = require('firebase-admin');

      // Mettre à jour le message avec les résultats
      await this.db.collection('messages').doc(doc.id).update({
        score: result.score,
        sentiment: result.sentiment,
        raisons: result.raisons || [],
        action: result.action || '',
        motsCles: result.motsCles || [],
        reponsesSuggerees: result.reponsesSuggerees || [],
        needsAnalysis: false,
        analyzedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ Message analysé - Score: ${result.score}/100`);

      // Retourner pour traitement ultérieur (envoi auto, alertes)
      return { messageId: doc.id, data: { ...data, ...result } };

    } catch (error) {
      console.error('❌ Erreur analyse message:', error.message);
      
      // Marquer comme erreur pour retry
      await this.db.collection('messages').doc(doc.id).update({
        needsAnalysis: false,
        analysisError: error.message
      });
    }
  }
}

module.exports = new MessageAnalyzerService();