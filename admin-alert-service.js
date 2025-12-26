const gmailService = require('./gmail-oauth-service');

class AdminAlertService {
  constructor() {
    this.adminUserId = null;
    this.adminEmail = null;
    this.db = null;
  }

  // Initialiser
  init(adminUserId, adminEmail) {
    this.adminUserId = adminUserId;
    this.adminEmail = adminEmail;
    const admin = require('firebase-admin');
    this.db = admin.firestore();
    console.log(`✅ Admin Alert Service initialisé (alertes → ${adminEmail})`);
  }

  // Vérifier si alerte nécessaire
  async checkAndAlert(messageId, messageData) {
    try {
      const score = messageData.score;
      
      // Alerte seulement si score ≥ 80
      if (score < 80) {
        return false;
      }

      console.log(`\n🚨 Score ${score} ≥ 80 → Alerte admin !`);

      // Récupérer les infos du client
      const clientDoc = await this.db.collection('clients').doc(messageData.clientId).get();
      
      if (!clientDoc.exists) {
        console.log('❌ Client introuvable');
        return false;
      }

      const client = clientDoc.data();

      // Construire l'email d'alerte
      const subject = `🚨 CLIENT CRITIQUE - Score ${score}/100 - ${client.name}`;
      const body = this.buildAlertEmailHTML(messageId, messageData, client);

      // Envoyer l'alerte à l'admin
      await gmailService.sendEmail(
        this.adminUserId,
        this.adminEmail,
        subject,
        body
      );

      console.log(`✅ Alerte envoyée à ${this.adminEmail}`);

      // Enregistrer dans Firebase
      const admin = require('firebase-admin');
      await this.db.collection('messages').doc(messageId).update({
        adminAlertSent: true,
        adminAlertSentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Créer un document d'alerte séparé
      await this.db.collection('critical_alerts').add({
        messageId: messageId,
        clientId: messageData.clientId,
        score: score,
        texte: messageData.texte,
        clientName: client.name,
        clientEmail: client.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        resolved: false
      });

      return true;

    } catch (error) {
      console.error('❌ Erreur alerte admin:', error.message);
      return false;
    }
  }

  // Template HTML email alerte
  buildAlertEmailHTML(messageId, messageData, client) {
    const reponses = messageData.reponsesSuggerees || [];
    const dashboardUrl = `http://localhost:5500/frontend/pages/client-detail.html?id=${messageData.clientId}`;

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
            background: linear-gradient(135deg, #dc2626, #991b1b);
            padding: 32px;
            border-radius: 12px 12px 0 0;
            text-align: center;
            color: white;
          }
          .alert-badge {
            font-size: 48px;
            margin-bottom: 16px;
          }
          .content {
            background: white;
            padding: 32px;
            border: 1px solid #e5e7eb;
            border-top: none;
            border-radius: 0 0 12px 12px;
          }
          .score-box {
            background: #fee;
            border: 2px solid #dc2626;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin: 20px 0;
          }
          .score-value {
            font-size: 48px;
            font-weight: bold;
            color: #dc2626;
          }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin: 20px 0;
          }
          .info-item {
            background: #f9fafb;
            padding: 12px;
            border-radius: 6px;
          }
          .info-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .info-value {
            font-weight: 600;
            color: #111827;
          }
          .message-box {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 16px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .response-box {
            background: #f0fdf4;
            border: 1px solid #86efac;
            padding: 16px;
            border-radius: 8px;
            margin: 12px 0;
          }
          .response-label {
            font-size: 11px;
            color: #059669;
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 8px;
          }
          .btn {
            display: inline-block;
            padding: 14px 32px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            margin: 20px 0;
          }
          .footer {
            margin-top: 32px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #6b7280;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="alert-badge">🚨</div>
          <h1 style="margin: 0; font-size: 32px;">CLIENT CRITIQUE</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Action immédiate requise</p>
        </div>
        <div class="content">
          <div class="score-box">
            <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">SCORE DE CHURN</div>
            <div class="score-value">${messageData.score}<span style="font-size: 24px;">/100</span></div>
            <div style="font-size: 14px; color: #dc2626; margin-top: 8px; font-weight: 600;">
              ⚠️ RISQUE ÉLEVÉ DE DÉPART
            </div>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Client</div>
              <div class="info-value">${client.name}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Email</div>
              <div class="info-value">${client.email}</div>
            </div>
          </div>

          <h3 style="color: #111827; margin-top: 24px;">📝 Message du client :</h3>
          <div class="message-box">
            "${messageData.texte}"
          </div>

          <h3 style="color: #111827; margin-top: 24px;">💡 Réponses suggérées par l'IA :</h3>
          ${reponses.map((rep, idx) => `
            <div class="response-box">
              <div class="response-label">${rep.ton}</div>
              <div>${rep.texte}</div>
            </div>
          `).join('')}

          <div style="text-align: center; margin-top: 32px;">
            <a href="${dashboardUrl}" class="btn">
              🎯 Répondre maintenant
            </a>
          </div>

          <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin-top: 24px; font-size: 14px;">
            <strong>⏰ Temps de réaction recommandé :</strong> Moins de 30 minutes<br>
            <strong>📊 Impact estimé :</strong> Perte potentielle d'un client
          </div>

          <div class="footer">
            Cette alerte a été générée automatiquement par Churn Predictor<br>
            Message ID: ${messageId}
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new AdminAlertService();