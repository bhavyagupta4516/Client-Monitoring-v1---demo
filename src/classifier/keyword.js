'use strict';

// Rules evaluated top-to-bottom — first match wins per category
const INTENT_RULES = [
  {
    intent: 'escalation',
    keywords: ['escalate', 'escalation', 'churn', 'cancel', 'cancellation', 'legal action',
               'sue', 'lawsuit', 'threatening', 'leaving', 'refund', 'compensation',
               'unacceptable', 'last warning', 'worst', 'pathetic', 'useless']
  },
  {
    intent: 'bug',
    keywords: ['bug', 'error', 'broken', 'not working', "doesn't work", 'stopped working',
               'crash', 'crashed', '500', '404', 'down', 'outage', 'failing', 'failed',
               'issue with', 'problem with']
  },
  {
    intent: 'feature_request',
    keywords: ['feature request', 'can you add', 'would be great if', 'please add',
               'enhancement', 'new feature', 'wish you had', 'missing feature']
  },
  {
    intent: 'request',
    keywords: ['please', 'can you', 'could you', 'need help', 'need this', 'asap',
               'waiting for', 'follow up', 'update on', 'status of', 'any update']
  },
  {
    intent: 'acknowledgement',
    keywords: ['thanks', 'thank you', 'thankyou', 'ok', 'okay', 'noted', 'got it',
               'sure', 'received', 'understood', '👍', '✅', '🙏', 'will do',
               'sounds good', 'perfect', 'great']
  }
];

const URGENCY_RULES = [
  {
    urgency: 'critical',
    keywords: ['production down', 'system down', 'completely down', 'data loss',
               'data breach', 'security breach', 'legal', 'immediately', 'emergency',
               'critical issue', 'business stopped']
  },
  {
    urgency: 'high',
    keywords: ['urgent', 'urgently', 'asap', 'as soon as possible', 'blocking',
               'stuck', 'cannot proceed', 'today', 'right now', 'immediately']
  },
  {
    urgency: 'medium',
    keywords: ['soon', 'when possible', 'this week', 'by end of day', 'eod', 'eow']
  }
];

const SENTIMENT_RULES = [
  {
    sentiment: 'negative',
    keywords: ['frustrated', 'frustrating', 'angry', 'annoyed', 'disappointed',
               'terrible', 'horrible', 'awful', 'bad experience', 'very upset',
               'not happy', "can't believe", 'ridiculous', 'shameful']
  },
  {
    sentiment: 'positive',
    keywords: ['great job', 'well done', 'impressive', 'love it', 'excellent',
               'very happy', 'fantastic', 'amazing', 'awesome', 'brilliant']
  }
];

function classify(text) {
  if (!text || text.trim().length === 0) {
    return { intent: 'general', urgency: 'low', sentiment: 'neutral' };
  }

  const lower = text.toLowerCase();

  let intent = 'general';
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      intent = rule.intent;
      break;
    }
  }

  let urgency = 'low';
  for (const rule of URGENCY_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      urgency = rule.urgency;
      break;
    }
  }
  // Escalations always warrant at least high urgency
  if (intent === 'escalation' && urgency === 'low') urgency = 'high';

  let sentiment = 'neutral';
  for (const rule of SENTIMENT_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      sentiment = rule.sentiment;
      break;
    }
  }
  // Escalations are always negative sentiment
  if (intent === 'escalation') sentiment = 'negative';

  return { intent, urgency, sentiment };
}

// True = fire Slack alert immediately, don't wait for SLA timer
function isImmediateAlert({ intent, urgency }) {
  return urgency === 'critical' || urgency === 'high' || intent === 'escalation';
}

// True = client just said thanks/ack — no action needed
function isAcknowledgement({ intent }) {
  return intent === 'acknowledgement';
}

module.exports = { classify, isImmediateAlert, isAcknowledgement };
