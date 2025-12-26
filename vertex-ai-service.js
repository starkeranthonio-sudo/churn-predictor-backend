const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');

class VertexAIService {
  constructor() {
    this.projects = [];
    this.currentProjectIndex = 0;
    this.model = null;
  }

  // Initialiser avec plusieurs projets
  init(projectConfigs) {
    this.projects = projectConfigs.map((config, index) => ({
      id: config.projectId,
      credentials: path.resolve(config.credentialsPath),
      name: `Project ${index + 1}`,
      location: 'us-central1'
    }));

    console.log(`✅ Vertex AI initialisé avec ${this.projects.length} projets`);
    
    // Initialiser le premier projet
    this.switchToProject(0);
  }

  // Basculer vers un projet
  switchToProject(index) {
    const project = this.projects[index];
    process.env.GOOGLE_APPLICATION_CREDENTIALS = project.credentials;
    
    const vertexAI = new VertexAI({
      project: project.id,
      location: project.location
    });

    this.model = vertexAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      }
    });

    this.currentProjectIndex = index;
    console.log(`   🔄 Utilisation: ${project.name} (${project.id})`);
  }

  // Analyser avec failover automatique
  async analyzeMessage(texte, clientId, historique, clientData) {
    const clientName = clientData.name || 'Client';

    const prompt = `Tu es un assistant IA expert en service client.

RÈGLES CRITIQUES :
1. DÉTECTE LA LANGUE et RÉPONDS DANS LA MÊME LANGUE
2. PERSONNALISATION : ${historique.length + 1}ème message
3. RÉPONDS À LA VRAIE PRÉOCCUPATION
4. SCORE : 0-30 satisfait, 30-60 neutre, 60-80 frustré, 80-100 critique

CLIENT : ${clientName}
EMAIL : ${clientData.email || 'inconnu'}
HISTORIQUE : ${historique.length} message(s)
${historique.length > 0 ? `\nDernières interactions :\n${historique.slice(0, 5).map((h, i) => `${i+1}. "${h.texte.substring(0, 100)}..." (${h.score})`).join('\n')}` : ''}

MESSAGE :
"${texte}"

Génère JSON (sans backticks) :
{
  "langue": "fr|en|es",
  "score": <0-100>,
  "sentiment": "positif|neutre|negatif",
  "raisons": ["raison 1", "raison 2"],
  "action": "action",
  "motsCles": ["mot1", "mot2"],
  "reponsesSuggerees": [
    {"ton": "empathique", "texte": "Avec ${clientName}"},
    {"ton": "solution", "texte": "Solution concrète"},
    {"ton": "compensation", "texte": "Geste commercial si score > 60"}
  ]
}`;

    // Essayer tous les projets jusqu'à succès
    for (let attempt = 0; attempt < this.projects.length; attempt++) {
      const projectIndex = (this.currentProjectIndex + attempt) % this.projects.length;
      
      try {
        if (attempt > 0) {
          this.switchToProject(projectIndex);
        }

        const result = await this.model.generateContent(prompt);
        const response = result.response;
        let text = response.text().trim();

        // Nettoyer markdown
        if (text.startsWith('```json')) {
          text = text.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
        } else if (text.startsWith('```')) {
          text = text.replace(/```\n?/g, '').replace(/```\n?$/g, '');
        }

        const parsed = JSON.parse(text);
        console.log(`   🤖 Gemini - Langue: ${parsed.langue}, Sentiment: ${parsed.sentiment}`);
        
        return parsed;

      } catch (error) {
        console.log(`   ❌ ${this.projects[projectIndex].name} échoué: ${error.message}`);
        
        if (attempt === this.projects.length - 1) {
          throw new Error(`Tous les projets Vertex AI ont échoué: ${error.message}`);
        }
      }
    }
  }
}

module.exports = new VertexAIService();