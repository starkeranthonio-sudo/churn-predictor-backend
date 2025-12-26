const { google } = require('googleapis');

// ========================================
// CONFIGURATION OAUTH
// ========================================
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
];

class GmailOAuthService {
  constructor() {
    this.oauth2Client = null;
    this.db = null;
  }

  // Initialiser Firestore (appelé automatiquement)
  initDB() {
    if (!this.db) {
      const admin = require('firebase-admin');
      this.db = admin.firestore();
    }
  }

  // Initialiser avec les credentials
  init(clientId, clientSecret, redirectUri) {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
  }

  // Générer l'URL d'autorisation
  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
  }

  // Échanger le code contre des tokens
  async getTokensFromCode(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  // Sauvegarder les tokens dans Firebase
  async saveTokens(userId, tokens) {
    this.initDB();
    await this.db.collection('gmail_tokens').doc(userId).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      updatedAt: require('firebase-admin').firestore.FieldValue.serverTimestamp()
    });
  }

  // Récupérer les tokens d'un utilisateur
  async getTokens(userId) {
    this.initDB();
    const doc = await this.db.collection('gmail_tokens').doc(userId).get();
    if (!doc.exists) {
      throw new Error('Gmail non connecté');
    }
    return doc.data();
  }

  // Vérifier si Gmail est connecté
  async isConnected(userId) {
    this.initDB();
    const doc = await this.db.collection('gmail_tokens').doc(userId).get();
    return doc.exists;
  }

  // Envoyer un email
  async sendEmail(userId, to, subject, body) {
    try {
      this.initDB();
      
      // Récupérer les tokens
      const tokens = await this.getTokens(userId);
      
      // Configurer OAuth client
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expiry_date: tokens.expiryDate
      });

      // Vérifier et refresh si nécessaire
      if (tokens.expiryDate < Date.now()) {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.saveTokens(userId, credentials);
        this.oauth2Client.setCredentials(credentials);
      }

      // Construire l'email
      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      
      const message = [
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        body
      ].join('\n');

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      });

      console.log(`✅ Email envoyé à ${to}`);
      return result.data;

    } catch (error) {
      console.error('❌ Erreur envoi email:', error.message);
      throw error;
    }
  }

  // Déconnecter Gmail
  async disconnect(userId) {
    this.initDB();
    await this.db.collection('gmail_tokens').doc(userId).delete();
  }
}

module.exports = new GmailOAuthService();