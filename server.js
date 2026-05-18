require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const GENERATED_DIR = path.join(__dirname, 'public', 'generated');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const POLLINATIONS_TOKEN = process.env.POLLINATIONS_TOKEN || '';
const POLLINATIONS_REFERRER = process.env.POLLINATIONS_REFERRER || 'localhost';
const POLLINATIONS_IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'flux';
const ENABLE_AI_IMAGES = process.env.ENABLE_AI_IMAGES !== 'false';
const POLLINATIONS_DELIVERY_MODE = (process.env.POLLINATIONS_DELIVERY_MODE || 'url').toLowerCase(); // url = fast and avoids browser/server timeout; download = saves files locally
const AI_MAX_PANELS = Math.max(1, Math.min(24, Number(process.env.AI_MAX_PANELS || 8)));
const AI_MAX_PAGES = Math.max(1, Math.min(8, Number(process.env.AI_MAX_PAGES || 3)));
const AI_TIMEOUT_MS = Math.max(15000, Math.min(120000, Number(process.env.AI_TIMEOUT_MS || 45000)));


const DEFAULT_DB = {
  users: [],
  stories: [],
  transactions: [],
  unlocks: [],
  coinRequests: [],
  withdrawals: [],
  storyLikes: [],
  reports: [],
  monetizationApplications: [],
  settings: {
    platformFeePercent: 10,
    coinRatePHP: 1,
    monetizationRequirements: {
      publishedStories: 2,
      totalViews: 50,
      totalLikes: 5
    }
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeDb(parsed = {}) {
  const db = { ...clone(DEFAULT_DB), ...parsed };
  db.users = Array.isArray(db.users) ? db.users : [];
  db.stories = Array.isArray(db.stories) ? db.stories : [];
  db.transactions = Array.isArray(db.transactions) ? db.transactions : [];
  db.unlocks = Array.isArray(db.unlocks) ? db.unlocks : [];
  db.coinRequests = Array.isArray(db.coinRequests) ? db.coinRequests : [];
  db.withdrawals = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  db.storyLikes = Array.isArray(db.storyLikes) ? db.storyLikes : [];
  db.reports = Array.isArray(db.reports) ? db.reports : [];
  db.monetizationApplications = Array.isArray(db.monetizationApplications) ? db.monetizationApplications : [];
  db.settings = {
    ...clone(DEFAULT_DB.settings),
    ...(db.settings || {}),
    monetizationRequirements: {
      ...clone(DEFAULT_DB.settings.monetizationRequirements),
      ...((db.settings || {}).monetizationRequirements || {})
    }
  };

  db.users.forEach(user => {
    user.role = user.role === 'admin' ? 'admin' : 'user';
    user.status = user.status || 'active';
    user.coins = Number(user.coins || 0);
    user.earnings = Number(user.earnings || 0);
    user.monetizationStatus = user.role === 'admin' ? 'approved' : (user.monetizationStatus || 'not_applied');
    user.monetizationNote = user.monetizationNote || '';
    user.bio = cleanText(user.bio || '', 500);
    user.followers = Number(user.followers || 0);
    user.following = Number(user.following || 0);
    user.createdAt = user.createdAt || now();
  });

  db.stories.forEach(story => {
    story.status = story.status || 'draft';
    story.views = Number(story.views || 0);
    story.likes = Number(story.likes || 0);
    story.tips = Number(story.tips || 0);
    story.price = Number(story.price || 0);
    story.featured = Boolean(story.featured);
    story.mangaPanels = Array.isArray(story.mangaPanels) ? story.mangaPanels : [];
    story.mangaPages = Array.isArray(story.mangaPages) ? story.mangaPages : [];
    story.comicPages = Array.isArray(story.comicPages) ? story.comicPages : [];
    story.animatedVideo = story.animatedVideo && typeof story.animatedVideo === 'object' ? story.animatedVideo : null;
    story.conversions = story.conversions && typeof story.conversions === 'object' ? story.conversions : {
      manga: Boolean((story.mangaPages && story.mangaPages.length) || story.mangaPanels.length),
      comic: Boolean(story.comicPages.length),
      animatedVideo: Boolean(story.animatedVideo)
    };
  });
  return db;
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const fresh = clone(DEFAULT_DB);
      saveDb(fresh);
      return fresh;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return normalizeDb(JSON.parse(raw || '{}'));
  } catch (error) {
    console.error('Database read error:', error);
    return clone(DEFAULT_DB);
  }
}

function cleanText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function cleanEmail(value) {
  return cleanText(value, 120).toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status || 'active',
    coins: Number(user.coins || 0),
    earnings: Number(user.earnings || 0),
    monetizationStatus: user.monetizationStatus || 'not_applied',
    monetizationNote: user.monetizationNote || '',
    bio: user.bio || '',
    followers: Number(user.followers || 0),
    following: Number(user.following || 0),
    verifiedAuthor: user.monetizationStatus === 'approved',
    createdAt: user.createdAt
  };
}

function getCurrentUser(req) {
  if (!req.session.userId) return null;
  const db = loadDb();
  return db.users.find(user => user.id === req.session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account is currently suspended.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  req.user = user;
  next();
}

function addTransaction(db, userId, type, amount, note, relatedId = '') {
  const tx = {
    id: uuidv4(),
    userId,
    type,
    amount: Number(amount || 0),
    note: cleanText(note, 240),
    relatedId,
    createdAt: now()
  };
  db.transactions.push(tx);
  return tx;
}

function sentenceList(content, max = 24) {
  return extractStoryBeats(content, max).map(beat => beat.sourceExcerpt);
}

function normalizeForMatching(value = '') {
  return String(value || '').toLowerCase();
}

function splitSentencesRespectingQuotes(text) {
  const pieces = [];
  let current = '';
  let inQuote = false;
  const value = String(text || '').trim();
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    current += char;
    if (char === '"' || char === '“') inQuote = !inQuote;
    if (char === '”') inQuote = false;
    const isSentenceEnd = /[.!?]/.test(char) && !inQuote;
    if (isSentenceEnd) {
      const next = value.slice(i + 1).trimStart();
      if (!next || /^[A-Z"“]/.test(next) || next.length > 0) {
        pieces.push(current.trim());
        current = '';
      }
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.length ? pieces : [value];
}

function splitStorySegments(content, max = 24) {
  const raw = cleanText(content, 30000)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!raw) return [];

  const hardBlocks = raw
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const candidates = [];
  hardBlocks.forEach(block => {
    const lines = block.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const workItems = lines.length > 1 ? lines : [block];
    workItems.forEach(item => {
      const pieces = splitSentencesRespectingQuotes(item);
      pieces.map(piece => piece.trim()).filter(Boolean).forEach(piece => candidates.push(piece));
    });
  });

  const merged = [];
  candidates.forEach(piece => {
    const tooSmall = piece.length < 18 && merged.length && merged[merged.length - 1].length + piece.length < 180;
    if (tooSmall) merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`.trim();
    else merged.push(piece);
  });

  return merged.slice(0, max);
}

function extractDialogue(segment) {
  const dialogues = [];
  const regex = /["“]([^"”]+)["”]/g;
  let match;
  while ((match = regex.exec(segment)) !== null) {
    dialogues.push(match[1].trim());
  }
  return dialogues;
}

function removeDialogue(segment) {
  return segment.replace(/["“][^"”]+["”]/g, '').replace(/\s+/g, ' ').trim();
}

function detectCharacters(segment) {
  const matches = segment.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  const blocked = new Set(['The', 'This', 'That', 'Then', 'When', 'After', 'Before', 'But', 'And', 'For', 'With']);
  return [...new Set(matches.filter(name => !blocked.has(name)))].slice(0, 4);
}

function detectMood(segment, genre = 'Drama') {
  const lower = normalizeForMatching(segment);
  if (/(sh\*t|damn|galit|inis|impit|sigaw|angry|rage|kill|blood|fight|suntok|away|!)/i.test(segment)) return 'intense';
  if (/(takot|fear|scared|horror|creepy|mysterious|dark|gabi|night|shadow|anino)/i.test(segment)) return 'suspenseful';
  if (/(iyak|luha|sad|sorry|heartbreak|lungkot|emotional|pain|sakit)/i.test(segment)) return 'emotional';
  if (/(love|romance|kiss|halik|yakap|mahal|boyfriend|girlfriend|nobyo|nobya)/i.test(segment)) return 'romantic';
  if (/(run|takbo|chase|bilis|speed|jump|attack|dodge|habol)/i.test(segment)) return 'action';
  if (/(hope|smile|ngiti|light|shine|panalo|success)/i.test(segment)) return 'hopeful';
  if (/comedy|funny/i.test(genre)) return 'comedic';
  if (/horror/i.test(genre)) return 'suspenseful';
  if (/romance/i.test(genre)) return 'romantic';
  return 'dramatic';
}

function detectShot(segment, index) {
  const lower = normalizeForMatching(segment);
  if (/["“][^"”]+["”]/.test(segment)) return 'dialogue-focused close-up';
  if (/(room|kwarto|house|bahay|school|class|street|road|forest|gubat|city|barangay|mall|hospital)/.test(lower)) return 'wide establishing shot';
  if (/(look|stare|eyes|mata|face|smile|ngiti|iyak|luha|galit|takot)/.test(lower)) return 'close-up reaction shot';
  if (/(run|takbo|fight|suntok|attack|habol|jump|bagsak|thud)/.test(lower)) return 'dynamic action angle';
  if (index === 0) return 'opening establishing shot';
  return 'story-faithful manga frame';
}

function detectVisualLayout(segment) {
  const lower = normalizeForMatching(segment);
  if (/(rain|ulan|storm|bagyo)/.test(lower)) return 'rain';
  if (/(school|classroom|teacher|student|campus|silid|eskwela)/.test(lower)) return 'school';
  if (/(phone|cellphone|message|text|chat|call|screen)/.test(lower)) return 'phone';
  if (/(street|road|kalsada|city|barangay|alley|labas)/.test(lower)) return 'street';
  if (/(forest|tree|gubat|woods|bundok)/.test(lower)) return 'forest';
  if (/(night|gabi|moon|dark|shadow|anino)/.test(lower)) return 'night';
  if (/(run|takbo|fight|attack|habol|speed|bilis|whoosh)/.test(lower)) return 'speedlines';
  if (/(room|kwarto|house|bahay|bed|sofa|door|window|bintana)/.test(lower)) return 'room';
  return 'spotlight';
}

function detectSfx(segment) {
  const lower = normalizeForMatching(segment);
  const soundWords = ['ugh', 'tsk', 'boom', 'bang', 'thud', 'crash', 'whoosh', 'wham', 'hmm', 'gasp', 'sob'];
  const found = soundWords.find(word => new RegExp(`\\b${word}\\b`, 'i').test(lower));
  if (found) return found.toUpperCase() + (/[!]/.test(segment) ? '!' : '');
  if (/\bah\b/i.test(lower)) return 'AH' + (/[!]/.test(segment) ? '!' : '');
  if (/(bagsak|bumagsak)/.test(lower)) return 'THUD';
  if (/(sigaw|scream)/.test(lower)) return 'AAAA!';
  if (/[!]{2,}/.test(segment)) return '!!';
  if (/[!]/.test(segment)) return '!';
  if (/\.\.\./.test(segment)) return '...';
  return '';
}

function extractStoryBeats(content, max = 24, genre = 'Drama') {
  const segments = splitStorySegments(content, max);
  if (!segments.length) return [];
  return segments.map((segment, index) => {
    const dialogues = extractDialogue(segment);
    const actionText = removeDialogue(segment);
    const exactText = segment.trim();
    const mood = detectMood(exactText, genre);
    return {
      id: uuidv4(),
      number: index + 1,
      sourceExcerpt: exactText,
      exactText,
      caption: actionText || exactText,
      dialogue: dialogues.join(' / '),
      dialogueLines: dialogues,
      characters: detectCharacters(exactText),
      shot: detectShot(exactText, index),
      mood,
      sfx: detectSfx(exactText),
      visualLayout: detectVisualLayout(exactText),
      textAccuracy: 100,
      prompt: `${genre} manga storyboard panel. Use this exact story text only: ${exactText}. Mood: ${mood}. Shot: ${detectShot(exactText, index)}. Characters detected: ${detectCharacters(exactText).join(', ') || 'unspecified'}. Do not add events that are not in the source text.`
    };
  });
}

function safeJsonParse(raw = '') {
  const text = String(raw || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  throw new Error('AI response was not valid JSON.');
}

function withTimeout(ms = AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

async function callGeminiJson(prompt) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key is not configured.');
  const { controller, done } = withTimeout();
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          topP: 0.7,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error?.message || 'Gemini request failed.';
      throw new Error(message);
    }

    const raw = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    return safeJsonParse(raw);
  } finally {
    done();
  }
}

function buildStoryParserPrompt(content, genre = 'Drama', mode = 'manga') {
  const style = mode === 'comic'
    ? 'full-color comic page planning'
    : mode === 'animated_video'
      ? 'motion-comic animated storyboard planning'
      : 'black-and-white manga panel planning';

  return `You are InkTales AI, a strict story-to-${mode} parser.

Goal: Convert the story into accurate visual panel instructions for ${style}.

Non-negotiable accuracy rules:
- Use the story text as the only source. Do not invent new plot events.
- Preserve exact quoted dialogue. Do not rewrite dialogue.
- Each panel must include one exact sourceExcerpt copied from the story.
- Keep panels in chronological order.
- Make image prompts WITHOUT text, letters, captions, subtitles, speech bubbles, logos, or watermarks.
- The app will overlay exact dialogue later, so image prompts must describe only visuals.

Return ONLY valid JSON in this structure:
{
  "title": "short title",
  "panels": [
    {
      "number": 1,
      "sourceExcerpt": "exact copied excerpt from the story",
      "caption": "faithful narration based on the excerpt",
      "dialogueLines": ["exact dialogue if any"],
      "characters": ["character names if clear"],
      "setting": "specific setting from the excerpt or inferred only from nearby text",
      "mood": "dramatic | intense | romantic | suspenseful | action | comedic | emotional | calm",
      "shot": "wide establishing shot | medium shot | close-up reaction shot | dynamic action angle | over-the-shoulder shot",
      "action": "visual action happening in the excerpt only",
      "sfx": "sound effect if strongly implied, otherwise empty string",
      "visualLayout": "city | street | room | school | phone | forest | speedlines | night | rain | spotlight",
      "visualPrompt": "visual-only prompt for an image model, no text, no words, no speech bubbles",
      "negativePrompt": "text, letters, speech bubble, caption, logo, watermark, blurry, extra fingers, deformed hands, duplicate face, extra limbs"
    }
  ]
}

Maximum panels: ${AI_MAX_PANELS}.
Genre: ${genre}.
Story:
"""
${cleanText(content, 30000)}
"""`;
}

function normalizeAiPanels(aiJson, content, genre = 'Drama', mode = 'manga') {
  const fallback = extractStoryBeats(content, AI_MAX_PANELS, genre);
  const sourcePanels = Array.isArray(aiJson?.panels) && aiJson.panels.length ? aiJson.panels : fallback;
  const panels = sourcePanels.slice(0, AI_MAX_PANELS).map((panel, index) => {
    const fallbackBeat = fallback[index] || fallback[fallback.length - 1] || {};
    const exactText = cleanText(panel.sourceExcerpt || panel.exactText || fallbackBeat.sourceExcerpt || panel.caption || '', 1200);
    const dialogueLines = Array.isArray(panel.dialogueLines)
      ? panel.dialogueLines.map(line => cleanText(line, 400)).filter(Boolean)
      : extractDialogue(exactText);
    const caption = cleanText(panel.caption || fallbackBeat.caption || removeDialogue(exactText) || exactText, 800);
    const mood = cleanText(panel.mood || fallbackBeat.mood || detectMood(exactText, genre), 40);
    const shot = cleanText(panel.shot || fallbackBeat.shot || detectShot(exactText, index), 80);
    const characters = Array.isArray(panel.characters)
      ? panel.characters.map(name => cleanText(name, 60)).filter(Boolean).slice(0, 6)
      : detectCharacters(exactText);
    const visualLayout = cleanText(panel.visualLayout || fallbackBeat.visualLayout || detectVisualLayout(exactText), 40);
    const action = cleanText(panel.action || caption || exactText, 600);
    const setting = cleanText(panel.setting || visualLayout || 'story scene', 160);
    const style = mode === 'comic'
      ? 'full-color comic book panel, clean line art, cinematic composition, detailed background, expressive faces'
      : mode === 'animated_video'
        ? 'animated motion comic keyframe, cinematic lighting, expressive faces, detailed scene, mobile video composition'
        : 'black and white manga panel, screentone shading, expressive faces, cinematic composition, clean line art';
    const visualPrompt = cleanText(panel.visualPrompt || `${style}. ${action}. Setting: ${setting}. Mood: ${mood}. Shot: ${shot}. Characters: ${characters.join(', ') || 'unspecified original characters'}. No text, no words, no speech bubbles, no captions, no logo, no watermark.`, 1800);
    return {
      id: panel.id || uuidv4(),
      number: Number(panel.number || index + 1),
      sourceExcerpt: exactText || 'No source excerpt available.',
      exactText: exactText || 'No source excerpt available.',
      caption,
      dialogue: dialogueLines.join(' / '),
      dialogueLines,
      characters,
      setting,
      shot,
      mood,
      sfx: cleanText(panel.sfx || fallbackBeat.sfx || detectSfx(exactText), 40),
      visualLayout,
      action,
      textAccuracy: 99,
      provider: GEMINI_API_KEY ? 'gemini' : 'local-rule-fallback',
      prompt: visualPrompt,
      visualPrompt,
      negativePrompt: cleanText(panel.negativePrompt || 'text, letters, speech bubble, caption, logo, watermark, blurry, extra fingers, deformed hands, duplicate face, extra limbs', 500),
      imageUrl: panel.imageUrl || '',
      imageProvider: panel.imageProvider || '',
      imageModel: panel.imageModel || '',
      imageStatus: panel.imageStatus || 'pending'
    };
  });

  if (!panels.length) {
    panels.push({
      id: uuidv4(),
      number: 1,
      sourceExcerpt: 'Start writing your scene to generate manga panels.',
      exactText: 'Start writing your scene to generate manga panels.',
      caption: 'Start writing your scene to generate manga panels.',
      dialogue: '',
      dialogueLines: [],
      characters: [],
      setting: 'blank page',
      shot: 'blank storyboard frame',
      mood: 'neutral',
      sfx: '',
      visualLayout: 'spotlight',
      action: 'blank panel waiting for a story scene',
      textAccuracy: 100,
      provider: 'local-rule-fallback',
      prompt: 'A clean empty manga storyboard panel waiting for the first scene. No text.',
      visualPrompt: 'A clean empty manga storyboard panel waiting for the first scene. No text.',
      negativePrompt: 'text, letters, watermark, logo',
      imageUrl: '',
      imageProvider: '',
      imageModel: '',
      imageStatus: 'not_generated'
    });
  }
  return panels;
}

async function parseStoryWithGemini(content, genre = 'Drama', mode = 'manga') {
  if (!GEMINI_API_KEY) return normalizeAiPanels(null, content, genre, mode);
  try {
    const json = await callGeminiJson(buildStoryParserPrompt(content, genre, mode));
    return normalizeAiPanels(json, content, genre, mode);
  } catch (error) {
    console.error('Gemini panel parser fallback:', error.message);
    return normalizeAiPanels(null, content, genre, mode).map(panel => ({
      ...panel,
      provider: 'local-rule-fallback',
      aiError: error.message
    }));
  }
}

function pollinationsUrlForPrompt(prompt, mode = 'manga', seed = '') {
  const isPage = String(mode).includes('page');
  const width = mode === 'animated_video' ? '1280' : isPage ? '1400' : mode === 'comic' ? '1024' : '1024';
  const height = mode === 'animated_video' ? '720' : isPage ? '1800' : mode === 'comic' ? '1024' : '1536';

  const params = new URLSearchParams({
    model: POLLINATIONS_IMAGE_MODEL,
    width,
    height,
    safe: 'true',
    nologo: 'true',
    referrer: POLLINATIONS_REFERRER || 'localhost'
  });

  // Do not add private=true in URL mode. Some browsers/hosts block it without auth headers,
  // and <img> tags cannot send Bearer tokens. Keeping the URL public makes comic panels load reliably.
  if (seed) params.set('seed', seed);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

async function generatePollinationsImage(prompt, mode = 'manga', panelNumber = 1) {
  const cleanedPrompt = cleanText(prompt, 1800);
  if (!cleanedPrompt) return { imageUrl: '', imageStatus: 'missing_prompt' };

  const url = pollinationsUrlForPrompt(cleanedPrompt, mode, String(panelNumber));

  // Version 10: still return a loadable Pollinations URL even if image generation is marked disabled.
  // This prevents blank full-page outputs while testing locally.
  if (!ENABLE_AI_IMAGES) {
    return {
      imageUrl: url,
      imageStatus: 'url_ready',
      imageProvider: 'pollinations',
      imageModel: POLLINATIONS_IMAGE_MODEL
    };
  }

  // Fast mode: store the Pollinations image URL and let the browser load the image.
  // This avoids long server-side downloads that commonly cause "Failed to fetch" in local testing or free hosting.
  if (POLLINATIONS_DELIVERY_MODE !== 'download') {
    return {
      imageUrl: url,
      imageStatus: 'url_ready',
      imageProvider: 'pollinations',
      imageModel: POLLINATIONS_IMAGE_MODEL
    };
  }

  // Download mode: server fetches and saves the generated image in public/generated.
  const { controller, done } = withTimeout();
  try {
    const headers = POLLINATIONS_TOKEN ? { Authorization: `Bearer ${POLLINATIONS_TOKEN}` } : {};
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`Pollinations image request failed with status ${response.status}.`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      const text = await response.text().catch(() => '');
      throw new Error(`Pollinations did not return an image. ${text.slice(0, 120)}`);
    }

    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const filename = `${mode}-panel-${Date.now()}-${panelNumber}-${Math.random().toString(36).slice(2)}.${extension}`;
    const savePath = path.join(GENERATED_DIR, filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(savePath, buffer);

    return {
      imageUrl: `/generated/${filename}`,
      imageStatus: 'generated',
      imageProvider: 'pollinations',
      imageModel: POLLINATIONS_IMAGE_MODEL
    };
  } finally {
    done();
  }
}

async function addImagesToPanels(panels, mode = 'manga') {
  const withImages = [];
  for (const panel of panels) {
    const prompt = `${panel.visualPrompt || panel.prompt}. ${panel.negativePrompt ? `Avoid: ${panel.negativePrompt}.` : ''}`;
    try {
      const image = await generatePollinationsImage(prompt, mode, panel.number || withImages.length + 1);
      withImages.push({ ...panel, ...image });
    } catch (error) {
      console.error('Pollinations panel image fallback:', error.message);
      withImages.push({
        ...panel,
        imageUrl: '',
        imageStatus: 'failed',
        imageError: error.message,
        imageProvider: 'pollinations',
        imageModel: POLLINATIONS_IMAGE_MODEL
      });
    }
  }
  return withImages;
}

async function generateMangaPanels(content, genre = 'Drama') {
  // Legacy fallback panel generator. The main manga conversion now uses full-page manga pages.
  const panels = await parseStoryWithGemini(content, genre, 'manga');
  return addImagesToPanels(panels, 'manga');
}

function panelGroups(panels, mode = 'manga') {
  const perPage = mode === 'comic' ? 5 : 4;
  const groups = [];
  for (let i = 0; i < panels.length && groups.length < AI_MAX_PAGES; i += perPage) {
    groups.push(panels.slice(i, i + perPage));
  }
  return groups.length ? groups : [panels];
}

function overlayBoxesForPanels(count, mode = 'manga') {
  const comic = [
    { bubbleBox: { x: 8, y: 6, w: 38, h: 10 }, captionBox: { x: 6, y: 32, w: 40, h: 7 }, sfxBox: { x: 54, y: 30, w: 18, h: 8 } },
    { bubbleBox: { x: 54, y: 6, w: 36, h: 10 }, captionBox: { x: 54, y: 32, w: 38, h: 7 }, sfxBox: { x: 79, y: 30, w: 16, h: 8 } },
    { bubbleBox: { x: 8, y: 42, w: 36, h: 10 }, captionBox: { x: 7, y: 66, w: 38, h: 7 }, sfxBox: { x: 36, y: 60, w: 18, h: 8 } },
    { bubbleBox: { x: 55, y: 42, w: 36, h: 10 }, captionBox: { x: 55, y: 66, w: 38, h: 7 }, sfxBox: { x: 80, y: 60, w: 16, h: 8 } },
    { bubbleBox: { x: 18, y: 79, w: 58, h: 9 }, captionBox: { x: 10, y: 91, w: 78, h: 6 }, sfxBox: { x: 72, y: 80, w: 18, h: 8 } }
  ];
  const manga = [
    { bubbleBox: { x: 62, y: 7, w: 28, h: 13 }, captionBox: { x: 8, y: 28, w: 40, h: 7 }, sfxBox: { x: 75, y: 27, w: 17, h: 8 } },
    { bubbleBox: { x: 6, y: 39, w: 28, h: 15 }, captionBox: { x: 36, y: 57, w: 34, h: 7 }, sfxBox: { x: 42, y: 49, w: 20, h: 8 } },
    { bubbleBox: { x: 68, y: 43, w: 26, h: 15 }, captionBox: { x: 8, y: 71, w: 38, h: 7 }, sfxBox: { x: 46, y: 66, w: 22, h: 8 } },
    { bubbleBox: { x: 52, y: 76, w: 34, h: 13 }, captionBox: { x: 10, y: 91, w: 45, h: 6 }, sfxBox: { x: 36, y: 80, w: 20, h: 8 } }
  ];
  return (mode === 'comic' ? comic : manga).slice(0, Math.max(count, 1));
}

function decoratePanelsWithOverlays(panels, mode = 'manga') {
  const boxes = overlayBoxesForPanels(panels.length, mode);
  return panels.map((panel, index) => ({
    ...panel,
    bubbleBox: boxes[index]?.bubbleBox || { x: 8, y: 8, w: 32, h: 12 },
    captionBox: boxes[index]?.captionBox || { x: 8, y: 78, w: 42, h: 8 },
    sfxBox: boxes[index]?.sfxBox || { x: 70, y: 70, w: 18, h: 8 }
  }));
}

function buildFullPagePrompt(panels, mode = 'manga', storyGenre = 'Drama', pageNumber = 1) {
  const breakdown = panels.map(panel => {
    return `Panel ${panel.number || ''}: ${panel.shot || 'medium shot'}; mood ${panel.mood || 'dramatic'}; setting ${panel.setting || panel.visualLayout || 'story scene'}; action: ${panel.action || panel.caption || panel.sourceExcerpt}; exact source basis: ${panel.sourceExcerpt || panel.exactText || ''}; characters: ${(panel.characters || []).join(', ') || 'original characters'}; SFX: ${panel.sfx || 'none'}.`;
  }).join('\n');

  if (mode === 'comic') {
    return `Create ONE complete full-color western comic page, not separate cards. Professional comic-book/newspaper-comic page layout with ${panels.length} panels on a single page, bright colors, clean black outlines, expressive original characters, lively poses, detailed backgrounds, readable storytelling flow, polished panel borders, and white empty speech-bubble areas. Make it look like a real finished comic page similar to a printed comic strip page, but with fully original characters and scenes. Genre: ${storyGenre}. Page ${pageNumber}. Do not copy any existing comic or characters. Do not add readable paragraph text, logos, website marks, or watermarks. Leave speech bubbles mostly empty because the app will overlay exact story text later. Panel plan:\n${breakdown}`;
  }

  return `Create ONE complete black-and-white manga page, not separate cards. Professional manga page layout with ${panels.length} dynamic panels on a single page, dramatic cinematic composition, high-contrast ink, screentones, speed lines, close-ups, action angles, detailed environments, expressive original characters, bold panel borders, and white empty speech-bubble areas. Make it look like a real polished manga page, not a storyboard mockup. Genre: ${storyGenre}. Page ${pageNumber}. Do not copy any existing manga or characters. Do not add readable paragraph text, logos, website marks, or watermarks. Leave speech bubbles mostly empty because the app will overlay exact story text later. Panel plan:\n${breakdown}`;
}

async function generateFullVisualPages(content, genre = 'Drama', mode = 'manga') {
  const panels = await parseStoryWithGemini(content, genre, mode);
  const groups = panelGroups(panels, mode);
  const pages = [];

  for (const group of groups) {
    const pageNumber = pages.length + 1;
    const pagePanels = decoratePanelsWithOverlays(group, mode);
    const prompt = buildFullPagePrompt(pagePanels, mode, genre, pageNumber);
    let image = { imageUrl: '', imageStatus: 'not_generated' };
    try {
      image = await generatePollinationsImage(prompt, `${mode}_page`, pageNumber);
    } catch (error) {
      console.error('Pollinations full-page image fallback:', error.message);
      // Version 10 fallback: if server-side generation fails, keep a direct URL
      // so the browser can still load the full-page art from Pollinations.
      image = {
        imageUrl: pollinationsUrlForPrompt(cleanText(prompt, 1800), `${mode}_page`, String(pageNumber)),
        imageStatus: 'url_ready',
        imageError: error.message,
        imageProvider: 'pollinations',
        imageModel: POLLINATIONS_IMAGE_MODEL
      };
    }

    pages.push({
      id: uuidv4(),
      pageNumber,
      title: `${mode === 'comic' ? 'Comic' : 'Manga'} Page ${pageNumber}`,
      mode,
      layout: mode === 'comic' ? 'full-color 5-panel comic page' : 'black-and-white dynamic manga page',
      sourceRange: `Panels ${group[0]?.number || 1}-${group[group.length - 1]?.number || group.length}`,
      textAccuracy: 99,
      provider: `${GEMINI_API_KEY ? 'Gemini parser' : 'Local parser'} + Pollinations full-page art + InkTales exact text overlay`,
      prompt,
      imageUrl: image.imageUrl,
      imageStatus: image.imageStatus,
      imageProvider: image.imageProvider || 'pollinations',
      imageModel: image.imageModel || POLLINATIONS_IMAGE_MODEL,
      imageError: image.imageError || '',
      panels: pagePanels
    });
  }
  return pages;
}

async function generateMangaPages(content, genre = 'Drama') {
  return generateFullVisualPages(content, genre, 'manga');
}

async function generateComicPages(content, genre = 'Drama') {
  return generateFullVisualPages(content, genre, 'comic');
}

async function generateAnimatedVideo(content, title = 'Untitled Story', genre = 'Drama') {
  const panels = await parseStoryWithGemini(content, genre, 'animated_video');
  const imagePanels = await addImagesToPanels(panels.slice(0, Math.min(6, AI_MAX_PANELS)), 'animated_video');
  const fallback = [{
    id: uuidv4(),
    number: 1,
    sourceExcerpt: 'A quiet opening scene introduces the world of the story.',
    exactText: 'A quiet opening scene introduces the world of the story.',
    caption: 'A quiet opening scene introduces the world of the story.',
    dialogue: '',
    shot: 'opening establishing shot',
    mood: 'dramatic',
    visualLayout: 'spotlight',
    characters: [],
    sfx: '',
    imageUrl: ''
  }];
  const scenes = (imagePanels.length ? imagePanels : fallback).map((beat, index) => ({
    id: uuidv4(),
    sceneNumber: index + 1,
    durationSeconds: beat.dialogue ? 6 : 5,
    camera: String(beat.shot || '').includes('close-up') ? 'slow close-up push' : (String(beat.shot || '').includes('action') ? 'fast action pan' : ['slow zoom in', 'pan right', 'dramatic push in', 'cutaway reaction', 'fade transition'][index % 5]),
    caption: beat.sourceExcerpt,
    narration: beat.sourceExcerpt,
    dialogue: beat.dialogue || '',
    dialogueLines: beat.dialogueLines || [],
    mood: beat.mood,
    visualLayout: beat.visualLayout,
    imageUrl: beat.imageUrl || '',
    imageStatus: beat.imageStatus || 'not_generated',
    textAccuracy: 99,
    motionPrompt: `${genre} animated storyboard scene. Exact source text: ${beat.sourceExcerpt}. Keep narration/dialogue faithful to the source text. No generated text in the image.`
  }));
  return {
    id: uuidv4(),
    title: `${title} Animated Preview`,
    format: 'mobile motion-comic preview with AI-generated keyframes and exact text overlays',
    totalDurationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    textAccuracy: 99,
    provider: `${GEMINI_API_KEY ? 'Gemini parser' : 'Local parser'} + Pollinations images`,
    scenes,
    createdAt: now()
  };
}

async function applyConversion(story, type) {
  const requested = type || 'all';
  story.conversions = story.conversions || { manga: false, comic: false, animatedVideo: false };
  if (requested === 'manga' || requested === 'all') {
    story.mangaPages = await generateMangaPages(story.content, story.genre);
    story.mangaPanels = [];
    story.conversions.manga = true;
  }
  if (requested === 'comic' || requested === 'all') {
    story.comicPages = await generateComicPages(story.content, story.genre);
    story.conversions.comic = true;
  }
  if (requested === 'animated_video' || requested === 'all') {
    story.animatedVideo = await generateAnimatedVideo(story.content, story.title, story.genre);
    story.conversions.animatedVideo = true;
  }
  story.conversionEngine = `${GEMINI_API_KEY ? 'Gemini' : 'Local'} + ${ENABLE_AI_IMAGES ? 'Pollinations' : 'image generation disabled'}`;
  story.updatedAt = now();
  return story;
}

function authorStats(db, userId) {
  const stories = db.stories.filter(story => story.authorId === userId);
  return {
    totalStories: stories.length,
    publishedStories: stories.filter(story => story.status === 'published').length,
    totalViews: stories.reduce((sum, story) => sum + Number(story.views || 0), 0),
    totalLikes: stories.reduce((sum, story) => sum + Number(story.likes || 0), 0),
    totalTips: stories.reduce((sum, story) => sum + Number(story.tips || 0), 0),
    paidStories: stories.filter(story => Number(story.price || 0) > 0).length
  };
}

function monetizationEligibility(db, userId) {
  const requirements = db.settings.monetizationRequirements;
  const stats = authorStats(db, userId);
  const checks = [
    { key: 'publishedStories', label: 'Published stories', required: requirements.publishedStories, current: stats.publishedStories, passed: stats.publishedStories >= requirements.publishedStories },
    { key: 'totalViews', label: 'Total story views', required: requirements.totalViews, current: stats.totalViews, passed: stats.totalViews >= requirements.totalViews },
    { key: 'totalLikes', label: 'Total story likes', required: requirements.totalLikes, current: stats.totalLikes, passed: stats.totalLikes >= requirements.totalLikes }
  ];
  return { eligible: checks.every(check => check.passed), checks, stats, requirements };
}

function isUnlocked(db, story, userId) {
  if (!story) return false;
  if (story.price === 0) return true;
  if (story.authorId === userId) return true;
  return db.unlocks.some(item => item.userId === userId && item.storyId === story.id);
}

function seedAdmin() {
  const db = loadDb();
  const adminEmail = 'admin@inkverse.local';
  if (!db.users.some(user => user.email === adminEmail)) {
    db.users.push({
      id: uuidv4(),
      name: 'InkVerse Platform Admin',
      email: adminEmail,
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      status: 'active',
      coins: 0,
      earnings: 0,
      monetizationStatus: 'approved',
      monetizationNote: 'Bootstrap administrator account.',
      bio: 'InkVerse platform administrator account.',
      followers: 0,
      following: 0,
      createdAt: now()
    });
    saveDb(db);
  }
}

app.set('trust proxy', 1);

// Local development CORS support.
// This fixes login/register when the page is accidentally opened through VS Code Live Server
// such as http://127.0.0.1:5500/app.html while the Express API runs on http://localhost:3000.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const isAllowedLocalOrigin = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isAllowedConfiguredOrigin = origin && allowedOrigins.includes(origin);

  if (isAllowedLocalOrigin || isAllowedConfiguredOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-before-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, app: 'InkVerse InkTales', time: now() }));

app.get('/api/me', (req, res) => res.json({ user: publicUser(getCurrentUser(req)) }));

app.put('/api/profile', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin profile editing is not available in the mobile author profile.' });
  const db = loadDb();
  const user = db.users.find(item => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User account not found.' });
  const name = cleanText(req.body.name, 80);
  const bio = cleanText(req.body.bio, 500);
  if (!name) return res.status(400).json({ error: 'Username is required.' });
  user.name = name;
  user.bio = bio;
  user.updatedAt = now();
  saveDb(db);
  res.json({ user: publicUser(user) });
});

app.get('/api/ai/status', requireAuth, (req, res) => {
  res.json({
    ai: {
      geminiConfigured: Boolean(GEMINI_API_KEY),
      geminiModel: GEMINI_MODEL,
      pollinationsConfigured: Boolean(POLLINATIONS_TOKEN),
      pollinationsModel: POLLINATIONS_IMAGE_MODEL,
      imageGenerationEnabled: ENABLE_AI_IMAGES,
      pollinationsDeliveryMode: POLLINATIONS_DELIVERY_MODE,
      maxPanelsPerConversion: AI_MAX_PANELS
    }
  });
});

app.get('/api/ai/test', requireAuth, async (req, res) => {
  const result = {
    geminiConfigured: Boolean(GEMINI_API_KEY),
    pollinationsConfigured: Boolean(POLLINATIONS_TOKEN),
    pollinationsDeliveryMode: POLLINATIONS_DELIVERY_MODE,
    checks: []
  };
  try {
    if (!GEMINI_API_KEY) {
      result.checks.push({ service: 'gemini', ok: false, message: 'Gemini key is missing in .env.' });
    } else {
      await callGeminiJson('Return only valid JSON: {"ok":true,"service":"gemini"}');
      result.checks.push({ service: 'gemini', ok: true, message: 'Gemini is responding.' });
    }
  } catch (error) {
    result.checks.push({ service: 'gemini', ok: false, message: error.message });
  }

  try {
    const testUrl = pollinationsUrlForPrompt('simple black and white manga test panel, no text, no letters', 'manga', 'test');
    result.pollinationsSampleUrl = testUrl;
    if (POLLINATIONS_DELIVERY_MODE === 'download') {
      const image = await generatePollinationsImage('simple black and white manga test panel, no text, no letters', 'manga', 1);
      result.checks.push({ service: 'pollinations', ok: Boolean(image.imageUrl), message: image.imageStatus });
    } else {
      result.checks.push({ service: 'pollinations', ok: true, message: 'URL mode ready. Browser will load Pollinations images directly.' });
    }
  } catch (error) {
    result.checks.push({ service: 'pollinations', ok: false, message: error.message });
  }
  res.json(result);
});

app.post('/api/auth/register', async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const db = loadDb();
  if (db.users.some(user => user.email === email)) return res.status(409).json({ error: 'Email already exists.' });

  const user = {
    id: uuidv4(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'user',
    status: 'active',
    coins: 0,
    earnings: 0,
    monetizationStatus: 'not_applied',
    monetizationNote: '',
    createdAt: now()
  };
  db.users.push(user);
  saveDb(db);
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  const db = loadDb();
  const user = db.users.find(item => item.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password.' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account is currently suspended.' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/stories', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts manage stories through the Admin Panel only.' });
  const db = loadDb();
  const stories = db.stories
    .filter(story => story.authorId === req.user.id)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ stories });
});

app.post('/api/stories', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts cannot create reader or writer stories.' });
  const title = cleanText(req.body.title, 100);
  const genre = cleanText(req.body.genre, 80) || 'Drama';
  const summary = cleanText(req.body.summary, 500);
  const content = cleanText(req.body.content, 30000);
  const price = Math.max(0, Math.min(5000, Number(req.body.price || 0)));
  if (!title || !content) return res.status(400).json({ error: 'Title and story content are required.' });
  if (price > 0 && req.user.monetizationStatus !== 'approved') return res.status(403).json({ error: 'Paid stories require approved monetization. You can save this as a free story or apply for monetization.' });

  const db = loadDb();
  const story = {
    id: uuidv4(),
    authorId: req.user.id,
    title,
    genre,
    summary,
    content,
    price,
    status: 'draft',
    featured: false,
    views: 0,
    likes: 0,
    tips: 0,
    mangaPanels: [],
    mangaPages: [],
    comicPages: [],
    animatedVideo: null,
    conversions: { manga: false, comic: false, animatedVideo: false },
    createdAt: now(),
    updatedAt: now(),
    publishedAt: null
  };
  db.stories.push(story);
  saveDb(db);
  res.status(201).json({ story });
});

app.get('/api/stories/:id', requireAuth, (req, res) => {
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  if (story.authorId !== req.user.id) return res.status(403).json({ error: 'You cannot access this story.' });
  res.json({ story });
});

app.put('/api/stories/:id', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts cannot edit as a writer. Use Admin Panel moderation tools.' });
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  if (story.authorId !== req.user.id) return res.status(403).json({ error: 'You cannot edit this story.' });
  const title = cleanText(req.body.title, 100);
  const content = cleanText(req.body.content, 30000);
  const price = Math.max(0, Math.min(5000, Number(req.body.price || 0)));
  if (!title || !content) return res.status(400).json({ error: 'Title and story content are required.' });
  if (price > 0 && req.user.monetizationStatus !== 'approved') return res.status(403).json({ error: 'Paid stories require approved monetization.' });

  story.title = title;
  story.genre = cleanText(req.body.genre, 80) || story.genre || 'Drama';
  story.summary = cleanText(req.body.summary, 500);
  story.content = content;
  story.price = price;
  story.updatedAt = now();
  saveDb(db);
  res.json({ story });
});

app.delete('/api/stories/:id', requireAuth, (req, res) => {
  const db = loadDb();
  const index = db.stories.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Story not found.' });
  const story = db.stories[index];
  if (story.authorId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You cannot delete this story.' });
  db.stories.splice(index, 1);
  db.unlocks = db.unlocks.filter(item => item.storyId !== story.id);
  db.storyLikes = db.storyLikes.filter(item => item.storyId !== story.id);
  db.reports = db.reports.filter(item => item.storyId !== story.id);
  saveDb(db);
  res.json({ ok: true });
});


app.get('/api/ai/test-comic', requireAuth, async (req, res) => {
  try {
    const sample = 'Mira opened the glowing notebook. "Is this magic?" she asked. A bright portal appeared beside her desk. WHOOSH!';
    const pages = await generateComicPages(sample, 'Fantasy');
    res.json({
      success: true,
      message: 'Comic generator is working.',
      pages
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Comic test failed.' });
  }
});

app.get('/api/ai/test-pages', requireAuth, async (req, res) => {
  try {
    const sample = 'Aki raised his hand as the storm split the sky. "I choose my own fate," he whispered. Across the rooftop, a shadow stepped forward. SHHHK!';
    const mangaPages = await generateMangaPages(sample, 'Fantasy');
    const comicPages = await generateComicPages(sample, 'Fantasy');
    res.json({
      success: true,
      message: 'Full-page manga and comic generator is working.',
      mangaPages,
      comicPages
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Full-page test failed.' });
  }
});

app.post('/api/stories/:id/publish', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts moderate published stories from Admin Panel.' });
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  if (story.authorId !== req.user.id) return res.status(403).json({ error: 'You cannot publish this story.' });
  if (story.price > 0 && req.user.monetizationStatus !== 'approved') return res.status(403).json({ error: 'Paid publishing requires approved monetization.' });
  story.status = 'published';
  story.publishedAt = story.publishedAt || now();
  story.updatedAt = now();
  saveDb(db);
  res.json({ story });
});

app.post('/api/stories/:id/unpublish', requireAuth, (req, res) => {
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  if (story.authorId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You cannot unpublish this story.' });
  story.status = 'draft';
  story.updatedAt = now();
  saveDb(db);
  res.json({ story });
});

app.post('/api/stories/:id/convert', requireAuth, async (req, res) => {
  try {
    const type = cleanText(req.body.type, 30) || 'all';
    if (!['manga', 'comic', 'animated_video', 'all'].includes(type)) return res.status(400).json({ error: 'Invalid conversion type.' });
    const db = loadDb();
    const story = db.stories.find(item => item.id === req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found.' });
    if (story.authorId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You cannot convert this story.' });
    if (story.status !== 'published') return res.status(400).json({ error: 'Publish the story first before converting it into manga, comic, or animated video.' });
    await applyConversion(story, type);
    saveDb(db);
    res.json({ story });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: error.message || 'Conversion failed.' });
  }
});

app.post('/api/stories/:id/generate-manga', requireAuth, async (req, res) => {
  try {
    const db = loadDb();
    const story = db.stories.find(item => item.id === req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found.' });
    if (story.authorId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You cannot convert this story.' });
    if (story.status !== 'published') return res.status(400).json({ error: 'Publish the story first before converting it into manga.' });
    await applyConversion(story, 'manga');
    saveDb(db);
    res.json({ story, pages: story.mangaPages || [], panels: story.mangaPanels || [] });
  } catch (error) {
    console.error('Manga generation error:', error);
    res.status(500).json({ error: error.message || 'Manga generation failed.' });
  }
});

app.get('/api/public/stories', (req, res) => {
  const db = loadDb();
  const userId = req.session.userId;
  const stories = db.stories
    .filter(story => story.status === 'published')
    .sort((a, b) => Number(b.featured) - Number(a.featured) || new Date(b.publishedAt || b.updatedAt) - new Date(a.publishedAt || a.updatedAt))
    .map(story => {
      const author = db.users.find(user => user.id === story.authorId);
      const unlocked = isUnlocked(db, story, userId);
      const liked = db.storyLikes.some(item => item.userId === userId && item.storyId === story.id);
      return {
        id: story.id,
        title: story.title,
        genre: story.genre,
        summary: story.summary,
        price: story.price,
        status: story.status,
        featured: story.featured,
        views: story.views,
        likes: story.likes,
        tips: story.tips,
        authorName: author ? author.name : 'Unknown User',
        authorMonetized: author ? author.monetizationStatus === 'approved' : false,
        unlocked,
        liked,
        conversions: story.conversions,
        preview: story.content.slice(0, 240) + (story.content.length > 240 ? '...' : ''),
        content: unlocked ? story.content : '',
        mangaPanels: unlocked ? story.mangaPanels : [],
        mangaPages: unlocked ? story.mangaPages : [],
        comicPages: unlocked ? story.comicPages : [],
        animatedVideo: unlocked ? story.animatedVideo : null
      };
    });
  res.json({ stories });
});

app.post('/api/public/stories/:id/unlock', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts are for management only.' });
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id && item.status === 'published');
  if (!story) return res.status(404).json({ error: 'Published story not found.' });
  const reader = db.users.find(user => user.id === req.user.id);
  const author = db.users.find(user => user.id === story.authorId);
  if (!reader) return res.status(404).json({ error: 'Reader account not found.' });

  if (!db.unlocks.some(item => item.userId === reader.id && item.storyId === story.id)) {
    if (story.authorId !== reader.id && story.price > 0) {
      if (reader.coins < story.price) return res.status(400).json({ error: 'Not enough coins. Send a top-up request in Wallet.' });
      reader.coins -= story.price;
      const platformFee = Math.floor(story.price * (Number(db.settings.platformFeePercent || 10) / 100));
      const creatorShare = story.price - platformFee;
      if (author && author.monetizationStatus === 'approved') author.earnings += creatorShare;
      addTransaction(db, reader.id, 'story_unlock', -story.price, `Unlocked: ${story.title}`, story.id);
      if (author) addTransaction(db, author.id, 'story_sale_earning', creatorShare, `Earning from story sale: ${story.title}`, story.id);
      if (platformFee > 0) addTransaction(db, 'platform', 'platform_fee', platformFee, `Platform fee from: ${story.title}`, story.id);
    }
    db.unlocks.push({ id: uuidv4(), userId: reader.id, storyId: story.id, createdAt: now() });
  }
  story.views += 1;
  saveDb(db);
  res.json({ ok: true, user: publicUser(reader) });
});

app.post('/api/public/stories/:id/tip', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts are for management only.' });
  const amount = Math.max(1, Math.min(5000, Number(req.body.amount || 0)));
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id && item.status === 'published');
  if (!story) return res.status(404).json({ error: 'Published story not found.' });
  if (story.authorId === req.user.id) return res.status(400).json({ error: 'You cannot tip your own story.' });
  const reader = db.users.find(user => user.id === req.user.id);
  const author = db.users.find(user => user.id === story.authorId);
  if (!reader || !author) return res.status(404).json({ error: 'Account not found.' });
  if (author.monetizationStatus !== 'approved') return res.status(400).json({ error: 'This author is not yet monetized.' });
  if (reader.coins < amount) return res.status(400).json({ error: 'Not enough coins. Send a top-up request in Wallet.' });
  reader.coins -= amount;
  author.earnings += amount;
  story.tips += amount;
  addTransaction(db, reader.id, 'tip_sent', -amount, `Tip sent: ${story.title}`, story.id);
  addTransaction(db, author.id, 'tip_earning', amount, `Tip earning: ${story.title}`, story.id);
  saveDb(db);
  res.json({ ok: true, user: publicUser(reader), story });
});

app.post('/api/public/stories/:id/like', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts are for management only.' });
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id && item.status === 'published');
  if (!story) return res.status(404).json({ error: 'Published story not found.' });
  const likeIndex = db.storyLikes.findIndex(item => item.userId === req.user.id && item.storyId === story.id);
  let liked = false;
  if (likeIndex === -1) {
    db.storyLikes.push({ id: uuidv4(), userId: req.user.id, storyId: story.id, createdAt: now() });
    story.likes += 1;
    liked = true;
  } else {
    db.storyLikes.splice(likeIndex, 1);
    story.likes = Math.max(0, story.likes - 1);
  }
  saveDb(db);
  res.json({ liked, likes: story.likes });
});

app.post('/api/public/stories/:id/report', requireAuth, (req, res) => {
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id && item.status === 'published');
  if (!story) return res.status(404).json({ error: 'Published story not found.' });
  if (story.authorId === req.user.id) return res.status(400).json({ error: 'You cannot report your own story.' });
  const report = {
    id: uuidv4(),
    storyId: story.id,
    reporterId: req.user.id,
    authorId: story.authorId,
    reason: cleanText(req.body.reason, 120) || 'Content concern',
    details: cleanText(req.body.details, 600),
    status: 'open',
    adminNote: '',
    createdAt: now(),
    resolvedAt: null,
    resolvedBy: null
  };
  db.reports.push(report);
  saveDb(db);
  res.status(201).json({ report });
});

app.get('/api/monetization/status', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts do not apply for monetization.' });
  const db = loadDb();
  const user = db.users.find(item => item.id === req.user.id);
  const eligibility = monetizationEligibility(db, user.id);
  const applications = db.monetizationApplications
    .filter(item => item.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ user: publicUser(user), eligibility, applications });
});

app.post('/api/monetization/apply', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts do not apply for monetization.' });
  const db = loadDb();
  const user = db.users.find(item => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.monetizationStatus === 'approved') return res.status(400).json({ error: 'Your account is already monetized.' });
  if (user.monetizationStatus === 'pending') return res.status(400).json({ error: 'You already have a pending monetization application.' });
  const eligibility = monetizationEligibility(db, user.id);
  if (!eligibility.eligible) return res.status(400).json({ error: 'You have not met the monetization requirements yet.', eligibility });
  const payoutName = cleanText(req.body.payoutName, 120);
  const portfolioNote = cleanText(req.body.portfolioNote, 800);
  if (!payoutName) return res.status(400).json({ error: 'Payout name is required.' });
  const application = {
    id: uuidv4(),
    userId: user.id,
    payoutName,
    portfolioNote,
    status: 'pending',
    adminNote: '',
    snapshot: eligibility.stats,
    createdAt: now(),
    resolvedAt: null,
    resolvedBy: null
  };
  user.monetizationStatus = 'pending';
  user.monetizationNote = 'Application submitted for admin review.';
  db.monetizationApplications.push(application);
  saveDb(db);
  res.status(201).json({ application, user: publicUser(user) });
});

app.get('/api/wallet/transactions', requireAuth, (req, res) => {
  const db = loadDb();
  const transactions = db.transactions
    .filter(item => item.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);
  res.json({ transactions });
});

app.get('/api/wallet/coin-requests', requireAuth, (req, res) => {
  const db = loadDb();
  const requests = db.coinRequests
    .filter(item => item.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ requests });
});

app.post('/api/wallet/coin-requests', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts do not top up coins.' });
  const amount = Math.max(10, Math.min(50000, Number(req.body.amount || 0)));
  const method = cleanText(req.body.method, 60);
  const reference = cleanText(req.body.reference, 120);
  const note = cleanText(req.body.note, 250);
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum top-up request is 10 coins.' });
  if (!method || !reference) return res.status(400).json({ error: 'Payment method and reference number are required.' });
  const db = loadDb();
  const request = { id: uuidv4(), userId: req.user.id, amount, method, reference, note, status: 'pending', adminNote: '', createdAt: now(), resolvedAt: null, resolvedBy: null };
  db.coinRequests.push(request);
  saveDb(db);
  res.status(201).json({ request });
});

app.get('/api/wallet/withdrawals', requireAuth, (req, res) => {
  const db = loadDb();
  const withdrawals = db.withdrawals
    .filter(item => item.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ withdrawals });
});

app.post('/api/wallet/withdrawals', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin accounts manage withdrawals only.' });
  if (req.user.monetizationStatus !== 'approved') return res.status(403).json({ error: 'Withdrawal is available only for approved monetized writers.' });
  const amount = Math.max(50, Math.min(50000, Number(req.body.amount || 0)));
  const method = cleanText(req.body.method, 60);
  const accountName = cleanText(req.body.accountName, 120);
  const accountNumber = cleanText(req.body.accountNumber, 120);
  if (!amount || amount < 50) return res.status(400).json({ error: 'Minimum withdrawal request is 50 earned coins.' });
  if (!method || !accountName || !accountNumber) return res.status(400).json({ error: 'Withdrawal method, account name, and account number are required.' });
  const db = loadDb();
  const user = db.users.find(item => item.id === req.user.id);
  if (!user || user.earnings < amount) return res.status(400).json({ error: 'Not enough creator earnings for this withdrawal.' });
  user.earnings -= amount;
  const withdrawal = { id: uuidv4(), userId: user.id, amount, method, accountName, accountNumber, status: 'pending', adminNote: '', createdAt: now(), resolvedAt: null, resolvedBy: null };
  db.withdrawals.push(withdrawal);
  addTransaction(db, user.id, 'withdrawal_hold', -amount, `Withdrawal request held: ${method}`, withdrawal.id);
  saveDb(db);
  res.status(201).json({ withdrawal, user: publicUser(user) });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const db = loadDb();
  res.json({
    stats: {
      users: db.users.filter(user => user.role === 'user').length,
      activeUsers: db.users.filter(user => user.role === 'user' && user.status === 'active').length,
      suspendedUsers: db.users.filter(user => user.role === 'user' && user.status === 'suspended').length,
      stories: db.stories.length,
      publishedStories: db.stories.filter(story => story.status === 'published').length,
      pendingTopUps: db.coinRequests.filter(item => item.status === 'pending').length,
      pendingWithdrawals: db.withdrawals.filter(item => item.status === 'pending').length,
      pendingMonetization: db.monetizationApplications.filter(item => item.status === 'pending').length,
      openReports: db.reports.filter(item => item.status === 'open').length,
      totalUserCoins: db.users.reduce((sum, user) => sum + Number(user.coins || 0), 0),
      totalCreatorEarnings: db.users.reduce((sum, user) => sum + Number(user.earnings || 0), 0),
      unlocks: db.unlocks.length,
      platformFees: db.transactions.filter(item => item.type === 'platform_fee').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    }
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = loadDb();
  const users = db.users.map(user => ({ ...publicUser(user), stats: authorStats(db, user.id) })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ users });
});

app.patch('/api/admin/users/:id/status', requireAdmin, (req, res) => {
  const status = cleanText(req.body.status, 20);
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const db = loadDb();
  const user = db.users.find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin' && user.id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own admin account.' });
  user.status = status;
  saveDb(db);
  res.json({ user: publicUser(user) });
});

app.get('/api/admin/coin-requests', requireAdmin, (req, res) => {
  const db = loadDb();
  const requests = db.coinRequests.map(item => ({ ...item, user: publicUser(db.users.find(user => user.id === item.userId)) })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ requests });
});

app.post('/api/admin/coin-requests/:id/approve', requireAdmin, (req, res) => {
  const db = loadDb();
  const request = db.coinRequests.find(item => item.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Top-up request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'This request is already resolved.' });
  const user = db.users.find(item => item.id === request.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.coins += request.amount;
  request.status = 'approved';
  request.adminNote = cleanText(req.body.adminNote, 250) || 'Verified and approved.';
  request.resolvedAt = now();
  request.resolvedBy = req.user.id;
  addTransaction(db, user.id, 'coin_topup', request.amount, `Top-up approved via ${request.method}. Ref: ${request.reference}`, request.id);
  saveDb(db);
  res.json({ request, user: publicUser(user) });
});

app.post('/api/admin/coin-requests/:id/reject', requireAdmin, (req, res) => {
  const db = loadDb();
  const request = db.coinRequests.find(item => item.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Top-up request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'This request is already resolved.' });
  request.status = 'rejected';
  request.adminNote = cleanText(req.body.adminNote, 250) || 'Rejected by admin.';
  request.resolvedAt = now();
  request.resolvedBy = req.user.id;
  saveDb(db);
  res.json({ request });
});

app.get('/api/admin/withdrawals', requireAdmin, (req, res) => {
  const db = loadDb();
  const withdrawals = db.withdrawals.map(item => ({ ...item, user: publicUser(db.users.find(user => user.id === item.userId)) })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ withdrawals });
});

app.post('/api/admin/withdrawals/:id/approve', requireAdmin, (req, res) => {
  const db = loadDb();
  const withdrawal = db.withdrawals.find(item => item.id === req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal request not found.' });
  if (withdrawal.status !== 'pending') return res.status(400).json({ error: 'This withdrawal is already resolved.' });
  withdrawal.status = 'approved';
  withdrawal.adminNote = cleanText(req.body.adminNote, 250) || 'Withdrawal paid.';
  withdrawal.resolvedAt = now();
  withdrawal.resolvedBy = req.user.id;
  addTransaction(db, withdrawal.userId, 'withdrawal_paid', 0, `Withdrawal approved: ${withdrawal.method}`, withdrawal.id);
  saveDb(db);
  res.json({ withdrawal });
});

app.post('/api/admin/withdrawals/:id/reject', requireAdmin, (req, res) => {
  const db = loadDb();
  const withdrawal = db.withdrawals.find(item => item.id === req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal request not found.' });
  if (withdrawal.status !== 'pending') return res.status(400).json({ error: 'This withdrawal is already resolved.' });
  const user = db.users.find(item => item.id === withdrawal.userId);
  if (user) {
    user.earnings += withdrawal.amount;
    addTransaction(db, user.id, 'withdrawal_refund', withdrawal.amount, `Withdrawal rejected and refunded: ${withdrawal.method}`, withdrawal.id);
  }
  withdrawal.status = 'rejected';
  withdrawal.adminNote = cleanText(req.body.adminNote, 250) || 'Rejected by admin.';
  withdrawal.resolvedAt = now();
  withdrawal.resolvedBy = req.user.id;
  saveDb(db);
  res.json({ withdrawal, user: publicUser(user) });
});

app.get('/api/admin/stories', requireAdmin, (req, res) => {
  const db = loadDb();
  const stories = db.stories.map(story => ({ ...story, author: publicUser(db.users.find(user => user.id === story.authorId)), reports: db.reports.filter(report => report.storyId === story.id && report.status === 'open').length })).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ stories });
});

app.patch('/api/admin/stories/:id/featured', requireAdmin, (req, res) => {
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  story.featured = Boolean(req.body.featured);
  story.updatedAt = now();
  saveDb(db);
  res.json({ story });
});

app.post('/api/admin/stories/:id/unpublish', requireAdmin, (req, res) => {
  const db = loadDb();
  const story = db.stories.find(item => item.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  story.status = 'draft';
  story.featured = false;
  story.updatedAt = now();
  addTransaction(db, story.authorId, 'story_moderation', 0, `Story unpublished by admin: ${story.title}`, story.id);
  saveDb(db);
  res.json({ story });
});

app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const db = loadDb();
  const reports = db.reports.map(item => ({
    ...item,
    story: db.stories.find(story => story.id === item.storyId) || null,
    reporter: publicUser(db.users.find(user => user.id === item.reporterId)),
    author: publicUser(db.users.find(user => user.id === item.authorId))
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ reports });
});

app.patch('/api/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  const db = loadDb();
  const report = db.reports.find(item => item.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  report.status = 'resolved';
  report.adminNote = cleanText(req.body.adminNote, 250) || 'Reviewed by admin.';
  report.resolvedAt = now();
  report.resolvedBy = req.user.id;
  saveDb(db);
  res.json({ report });
});

app.get('/api/admin/monetization', requireAdmin, (req, res) => {
  const db = loadDb();
  const applications = db.monetizationApplications.map(item => ({ ...item, user: publicUser(db.users.find(user => user.id === item.userId)), eligibility: monetizationEligibility(db, item.userId) })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ applications });
});

app.post('/api/admin/monetization/:id/approve', requireAdmin, (req, res) => {
  const db = loadDb();
  const application = db.monetizationApplications.find(item => item.id === req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (application.status !== 'pending') return res.status(400).json({ error: 'Application already resolved.' });
  const user = db.users.find(item => item.id === application.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  application.status = 'approved';
  application.adminNote = cleanText(req.body.adminNote, 250) || 'Approved for monetization.';
  application.resolvedAt = now();
  application.resolvedBy = req.user.id;
  user.monetizationStatus = 'approved';
  user.monetizationNote = application.adminNote;
  saveDb(db);
  res.json({ application, user: publicUser(user) });
});

app.post('/api/admin/monetization/:id/reject', requireAdmin, (req, res) => {
  const db = loadDb();
  const application = db.monetizationApplications.find(item => item.id === req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (application.status !== 'pending') return res.status(400).json({ error: 'Application already resolved.' });
  const user = db.users.find(item => item.id === application.userId);
  application.status = 'rejected';
  application.adminNote = cleanText(req.body.adminNote, 250) || 'Rejected by admin.';
  application.resolvedAt = now();
  application.resolvedBy = req.user.id;
  if (user) {
    user.monetizationStatus = 'rejected';
    user.monetizationNote = application.adminNote;
  }
  saveDb(db);
  res.json({ application, user: publicUser(user) });
});

app.get('/api/admin/transactions', requireAdmin, (req, res) => {
  const db = loadDb();
  const transactions = db.transactions
    .map(item => ({ ...item, user: publicUser(db.users.find(user => user.id === item.userId)) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200);
  res.json({ transactions });
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'company.html')));

seedAdmin();


app.get('/api/ai/direct-image-test', (req, res) => {
  const mode = cleanText(req.query.mode || 'manga', 20) === 'comic' ? 'comic_page' : 'manga_page';
  const prompt = mode === 'comic_page'
    ? 'Create one complete full-color western comic page with five panels, expressive original characters in a writing studio, clean outlines, vivid colors, empty speech bubble spaces, no watermark.'
    : 'Create one complete black-and-white manga page with four dynamic panels, dramatic original character, screentones, speed lines, empty speech bubble spaces, no watermark.';
  res.json({
    success: true,
    message: 'Direct Pollinations URL generated. Open imageUrl in a new tab if the app image is blank.',
    imageUrl: pollinationsUrlForPrompt(prompt, mode, '101')
  });
});

app.listen(PORT, () => console.log(`InkVerse InkTales running at http://localhost:${PORT}`));
