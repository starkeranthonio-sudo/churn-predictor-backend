// ========================================
// MOTEUR D'ANALYTICS PRÉDICTIF
// ========================================

class AnalyticsEngine {
  constructor() {
    this.historique = [];
    this.insights = [];
    this.seuils = {
      scoreEleveMoyen: 60,
      tauxCritique: 0.15, // 15% de clients critiques = alerte
      variationAnormale: 20 // +20 points en moyenne = anomalie
    };
  }

  // ========================================
  // AJOUT DE DONNÉES
  // ========================================
  ajouterMessage(data) {
    this.historique.push({
      timestamp: new Date(data.timestamp),
      score: data.score,
      sentiment: data.sentiment,
      motsCles: data.motsCles || [],
      clientId: data.clientId
    });

    // Limite à 100 derniers messages pour performance
    if (this.historique.length > 100) {
      this.historique.shift();
    }

    // Analyse après chaque ajout
    this.analyser();
  }

  // ========================================
  // CALCULS STATISTIQUES
  // ========================================
  
  getStatistiques() {
    if (this.historique.length === 0) {
      return {
        total: 0,
        scoreMoyen: 0,
        tauxCritique: 0,
        tauxPositif: 0,
        tendance: 0
      };
    }

    const scores = this.historique.map(m => m.score);
    const scoreMoyen = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    const nbCritiques = this.historique.filter(m => m.score >= 80).length;
    const tauxCritique = (nbCritiques / this.historique.length) * 100;
    
    const nbPositifs = this.historique.filter(m => m.score < 35).length;
    const tauxPositif = (nbPositifs / this.historique.length) * 100;

    // Tendance (différence entre moyenne des 5 derniers vs 5 précédents)
    const tendance = this.calculerTendance();

    return {
      total: this.historique.length,
      scoreMoyen: Math.round(scoreMoyen),
      tauxCritique: Math.round(tauxCritique),
      tauxPositif: Math.round(tauxPositif),
      tendance: Math.round(tendance)
    };
  }

  calculerTendance() {
    if (this.historique.length < 10) return 0;

    const derniers5 = this.historique.slice(-5).map(m => m.score);
    const precedents5 = this.historique.slice(-10, -5).map(m => m.score);

    const moyenneDerniers = derniers5.reduce((a, b) => a + b) / 5;
    const moyennePrecedents = precedents5.reduce((a, b) => a + b) / 5;

    return moyenneDerniers - moyennePrecedents;
  }

  // ========================================
  // RÉGRESSION LINÉAIRE POUR PRÉDICTION
  // ========================================
  
  calculerRegression() {
    if (this.historique.length < 5) return null;

    const n = Math.min(this.historique.length, 20); // 20 derniers points
    const data = this.historique.slice(-n);

    // x = index, y = score
    const sumX = data.reduce((sum, _, i) => sum + i, 0);
    const sumY = data.reduce((sum, m) => sum + m.score, 0);
    const sumXY = data.reduce((sum, m, i) => sum + (i * m.score), 0);
    const sumX2 = data.reduce((sum, _, i) => sum + (i * i), 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  predireProchainScore() {
    const regression = this.calculerRegression();
    if (!regression) return null;

    const prochainIndex = this.historique.length;
    const prediction = regression.slope * prochainIndex + regression.intercept;

    return {
      score: Math.max(0, Math.min(100, Math.round(prediction))),
      tendance: regression.slope > 0 ? 'hausse' : 'baisse',
      confiance: this.calculerConfiance(regression.slope)
    };
  }

  calculerConfiance(slope) {
    // Confiance basée sur la stabilité de la pente
    const absSlope = Math.abs(slope);
    if (absSlope < 0.5) return 'élevée';
    if (absSlope < 2) return 'moyenne';
    return 'faible';
  }

  // ========================================
  // DÉTECTION D'ANOMALIES
  // ========================================
  
  detecterAnomalies() {
    if (this.historique.length < 10) return [];

    const anomalies = [];
    const stats = this.getStatistiques();

    // Anomalie 1 : Augmentation brutale du score moyen
    if (stats.tendance > this.seuils.variationAnormale) {
      anomalies.push({
        type: 'tendance_hausse',
        severite: 'haute',
        titre: `Augmentation de ${stats.tendance} points en moyenne`,
        description: 'Les scores de churn augmentent rapidement',
        impact: this.calculerImpact(stats.tendance)
      });
    }

    // Anomalie 2 : Taux de clients critiques élevé
    if (stats.tauxCritique > this.seuils.tauxCritique * 100) {
      anomalies.push({
        type: 'taux_critique',
        severite: 'haute',
        titre: `${stats.tauxCritique}% de clients à risque critique`,
        description: 'Proportion anormalement élevée de clients sur le point de partir',
        impact: Math.round(stats.tauxCritique / 10)
      });
    }

    // Anomalie 3 : Mots-clés récurrents
    const motsClesFrequents = this.analyserMotsCles();
    if (motsClesFrequents.length > 0) {
      anomalies.push({
        type: 'mots_cles',
        severite: 'moyenne',
        titre: `Problème récurrent détecté: "${motsClesFrequents[0].mot}"`,
        description: `Mentionné ${motsClesFrequents[0].freq} fois récemment`,
        impact: motsClesFrequents[0].freq
      });
    }

    return anomalies;
  }

  calculerImpact(tendance) {
    // Impact = nombre de clients qui pourraient atteindre zone critique
    const clientsAuBord = this.historique.filter(m => 
      m.score >= 60 && m.score < 80
    ).length;

    return Math.round(clientsAuBord * (tendance / 20));
  }

  // ========================================
  // ANALYSE DES MOTS-CLÉS
  // ========================================
  
  analyserMotsCles() {
    const derniers20 = this.historique.slice(-20);
    const compteur = {};

    derniers20.forEach(msg => {
      (msg.motsCles || []).forEach(mot => {
        compteur[mot] = (compteur[mot] || 0) + 1;
      });
    });

    return Object.entries(compteur)
      .map(([mot, freq]) => ({ mot, freq }))
      .filter(item => item.freq >= 3) // Au moins 3 occurrences
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 5);
  }

  // ========================================
  // GÉNÉRATION D'INSIGHTS
  // ========================================
  
  analyser() {
    this.insights = [];

    const stats = this.getStatistiques();
    const prediction = this.predireProchainScore();
    const anomalies = this.detecterAnomalies();

    // Insight 1 : Prédiction
    if (prediction) {
      this.insights.push({
        type: 'prediction',
        titre: 'Prédiction prochaine interaction',
        valeur: `Score prédit : ${prediction.score}/100`,
        detail: `Tendance ${prediction.tendance} (confiance ${prediction.confiance})`,
        icone: prediction.tendance === 'hausse' ? '📈' : '📉'
      });
    }

    // Insight 2 : État global
    if (stats.scoreMoyen > 60) {
      this.insights.push({
        type: 'alerte',
        titre: 'Niveau de satisfaction critique',
        valeur: `Score moyen : ${stats.scoreMoyen}/100`,
        detail: `${stats.tauxCritique}% de clients à risque imminent`,
        icone: '🚨'
      });
    } else if (stats.scoreMoyen < 35) {
      this.insights.push({
        type: 'success',
        titre: 'Excellente satisfaction client',
        valeur: `Score moyen : ${stats.scoreMoyen}/100`,
        detail: `${stats.tauxPositif}% de clients satisfaits`,
        icone: '✅'
      });
    }

    // Insight 3 : Anomalies
    anomalies.forEach(anomalie => {
      this.insights.push({
        type: anomalie.type,
        titre: anomalie.titre,
        valeur: anomalie.description,
        detail: `Impact estimé : ${anomalie.impact} clients`,
        icone: '⚠️'
      });
    });

    return this.insights;
  }

  // ========================================
  // DONNÉES POUR GRAPHIQUES
  // ========================================
  
  getDonneesGraphique() {
    const derniers30 = this.historique.slice(-30);
    
    return {
      labels: derniers30.map((_, i) => `M${i + 1}`),
      scores: derniers30.map(m => m.score),
      moyenne: derniers30.map((_, i, arr) => {
        // Moyenne mobile sur 5 points
        const debut = Math.max(0, i - 4);
        const slice = arr.slice(debut, i + 1);
        return Math.round(slice.reduce((sum, m) => sum + m.score, 0) / slice.length);
      })
    };
  }

  getHeatmapMotsCles() {
    const motsCles = this.analyserMotsCles();
    return motsCles.map(item => ({
      mot: item.mot,
      valeur: item.freq,
      pourcentage: Math.round((item.freq / this.historique.length) * 100)
    }));
  }
}

module.exports = AnalyticsEngine;