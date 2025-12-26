const gmailService = require('./gmail-oauth-service');

class AutoResponseService {
  constructor() {
    this.adminUserId = null;
    this.db = null;
  }

  // Initialiser
  init(adminUserId) {
    this.adminUserId = adminUserId;
    const admin = require('firebase-admin');
    this.db = admin.firestore();
    console.log('✅ Auto Response Service initialisé');
  }

  // Vérifier si envoi automatique nécessaire
  async checkAndSend(messageId, messageData) {
    try {
      const score = messageData.score;
      
      // Envoi automatique seulement si score < 60
      if (score >= 60) {
        console.log(`⏸️  Score ${score} - Pas d'envoi auto (validation requise)`);
        return false;
      }

      console.log(`\n🤖 Score ${score} < 60 → Envoi automatique activé`);

      // Récupérer les infos du client
      const clientDoc = await this.db.collection('clients').doc(messageData.clientId).get();
      
      if (!clientDoc.exists) {
        console.log('❌ Client introuvable');
        return false;
      }

      const client = clientDoc.data();
      
      if (!client.email) {
        console.log('❌ Email client manquant');
        return false;
      }

      // Prendre la première réponse suggérée (ton empathique)
      const reponses = messageData.reponsesSuggerees || [];
      
      if (reponses.length === 0) {
        console.log('❌ Aucune réponse suggérée');
        return false;
      }

      const bestResponse = reponses[0]; // Empathique par défaut

      // Construire l'email
      const subject = `Re: ${messageData.subject || 'Votre message'}`;
      const body = this.buildEmailHTML(client.name, messageData.texte, bestResponse.texte);

      // Envoyer l'email
      await gmailService.sendEmail(
        this.adminUserId,
        client.email,
        subject,
        body
      );

      console.log(`✅ Email auto envoyé à ${client.email}`);

      // Enregistrer dans Firebase
      const admin = require('firebase-admin');
      await this.db.collection('messages').doc(messageId).update({
        emailSent: true,
        emailSentAuto: true,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        responseSent: bestResponse.texte,
        responseTone: bestResponse.ton
      });

      return true;

    } catch (error) {
      console.error('❌ Erreur envoi auto:', error.message);
      return false;
    }
  }

  // Template HTML email
  buildEmailHTML(clientName, originalMessage, response) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.6;
            color: #374151;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            padding: 32px;
            border-radius: 12px 12px 0 0;
            text-align: center;
            color: white;
          }
          .content {
            background: white;
            padding: 32px;
            border: 1px solid #e5e7eb;
            border-top: none;
            border-radius: 0 0 12px 12px;
          }
          .message {
            background: #f3f4f6;
            padding: 16px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #667eea;
            font-style: italic;
          }
          .response {
            margin: 24px 0;
            line-height: 1.8;
          }
          .footer {
            margin-top: 32px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #6b7280;
            text-align: center;
          }
          .badge {
            display: inline-block;
            padding: 4px 12px;
            background: #10b981;
            color: white;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 16px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0; font-size: 28px;">🔥 Réponse Automatique</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Notre IA a analysé votre message</p>
        </div>
        <div class="content">
          <div class="badge">✨ Réponse instantanée</div>
          
          <p>Bonjour <strong>${clientName}</strong>,</p>
          
          <p>Merci pour votre message :</p>
          <div class="message">
            "${originalMessage.substring(0, 200)}${originalMessage.length > 200 ? '...' : ''}"
          </div>
          
          <div class="response">
            ${response}
          </div>
          
          <p style="margin-top: 24px;">
            Cordialement,<br>
            <strong>L'équipe Support</strong>
          </p>
          
          <div class="footer">
            Cette réponse a été générée automatiquement par notre IA.<br>
            Si vous avez besoin d'une assistance supplémentaire, n'hésitez pas à répondre à cet email.
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new AutoResponseService();