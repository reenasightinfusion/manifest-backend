require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const bodyParser = require('body-parser');


const app = express();
const port = process.env.PORT || 3000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_URL_HERE') {
  console.error('\x1b[31m%s\x1b[0m', 'CRITICAL ERROR: SUPABASE_URL is missing or placeholder! Check your backend/.env file.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json());

// Health Check
app.get('/', (req, res) => {
  res.send('Manifest Cosmic Backend is Live! ✨');
});

// Create/Update User API
app.post('/api/users', async (req, res) => {
  console.log('Incoming user update/creation:', req.body);
  const { id, full_name, avatar_url, personal_answers, family_answers, professional_answers } = req.body;

  if (!full_name) {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }

  try {
    let result;
    if (id) {
      // UPDATE existing user
      const { data, error } = await supabase
        .from('users')
        .update({
          full_name,
          avatar_url,
          personal_answers,
          family_answers,
          professional_answers
        })
        .eq('id', id)
        .select();
      
      if (error) throw error;
      result = data[0];
    } else {
      // INSERT new user
      const { data, error } = await supabase
        .from('users')
        .insert([
          {
            full_name,
            avatar_url,
            personal_answers,
            family_answers,
            professional_answers,
            created_at: new Date().toISOString()
          }
        ])
        .select();
      
      if (error) throw error;
      result = data[0];
    }

    res.status(id ? 200 : 201).json({
      success: true,
      message: id ? 'Cosmic identity updated!' : 'User identity established!',
      data: result
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync identity.',
      error: error.message
    });
  }
});

// Search User by Name (Smart Discovery)
app.get('/api/users/search', async (req, res) => {
  const { name } = req.query;
  try {
    // 1. Fetch all potential matches
    const { data: matches, error } = await supabase
      .from('users')
      .select('*, manifestations(count)')
      .eq('full_name', name)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Identity not found.' });
    }

    // 2. Smart Selection: Prioritize the soul with the most history or answers
    let bestMatch = matches[0];
    let maxQuality = -1;

    for (let u of matches) {
      const manifestCount = u.manifestations?.[0]?.count || 0;
      const answersFilled = [...(u.personal_answers || []), ...(u.family_answers || []), ...(u.professional_answers || [])].filter(a => a.trim().length > 0).length;
      
      const quality = (manifestCount * 10) + answersFilled; // Manifestations are high priority
      
      if (quality > maxQuality) {
        maxQuality = quality;
        bestMatch = u;
      }
    }

    // Cleanup for response
    delete bestMatch.manifestations;

    res.json({ success: true, data: bestMatch });
  } catch (error) {
    console.error('Search Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

const fetch = require('node-fetch');

// ─── AI Hub Bridge (Centralized Management) ───────────────────────────
async function generateAI(prompt, systemPrompt = 'You are a Master Manifestation Coach.') {
  const hubUrl = process.env.AI_HUB_URL || 'http://localhost:3001/api/generate';
  
  console.log(`📡 Relaying request to AI Hub: ${hubUrl}`);
  
  const response = await fetch(hubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      prompt, 
      systemPrompt, 
      format: 'json' 
    })
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`AI Hub Error: ${data.error}`);
  }

  console.log(`✔️ Response received from Provider: ${data.provider}`);
  return data.data;
}


// ─── AI Manifestation Blueprint Generator ─────────────────────────────────
app.post('/api/generate-plan', async (req, res) => {
  const { user_id, goal_title } = req.body;

  try {
    // 1. Fetch User DNA
    const { data: user, error: userError } = await supabase
      .from('users').select('*').eq('id', user_id).single();
    if (userError || !user) throw new Error(`User not found: ${user_id}`);

    // 2. Build the hyper-personalized prompt
    const prompt = `
      You are a Master Manifestation Architect and Life Coach.
      
      USER PROFILE:
      - Name: ${user.full_name}
      - Goal: "${goal_title}"
      - Personal answers: ${(user.personal_answers || []).join(', ')}
      - Family answers: ${(user.family_answers || []).join(', ')}
      - Professional answers: ${(user.professional_answers || []).join(', ')}
      
      TASK: Generate a hyper-personalized manifestation blueprint for "${goal_title}".
      Create 4 unique topical PILLARS (NOT day-by-day steps). Each pillar should be a different angle/dimension of how to manifest this goal.
      Deeply reference the user's personal and professional background in each pillar.
      
      Return ONLY this JSON structure:
      {
        "plan_title": "A profound, unique 6-8 word title for this blueprint",
        "overall_summary": "A 3-sentence powerful summary of why this blueprint works for ${user.full_name} specifically",
        "pillars": [
          {
            "title": "Emoji + Pillar Name (e.g. 🔥 The Identity Breakthrough)",
            "huge_text": "A rich, 200+ word deep-dive manifesto for this specific pillar. Must reference user's actual answers and goal directly. Include psychological insights, practical techniques, and inspiring language.",
            "summary": "A 2-sentence crystallized essence of this pillar."
          },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." }
        ]
      }
    `;

    // 3. Generate with Groq
    console.log(`🧠 Generating AI manifesto for ${user.full_name}: "${goal_title}"...`);
    const aiResponse = await generateAI(prompt);
    console.log(`✨ AI Manifesto Ready!`);

    // 4. Save to Supabase
    const { data: manifestation } = await supabase
      .from('manifestations').insert([{ user_id, goal_title }]).select().single();

    const { data: plan } = await supabase
      .from('manifestation_plans')
      .insert([{
        manifestation_id: manifestation.id,
        plan_title: aiResponse.plan_title,
        summary: aiResponse.overall_summary,
        full_content: JSON.stringify(aiResponse),
        audio_url: `https://api.dicebear.com/7.x/avataaars/png?seed=${user_id}`
      }])
      .select().single();

    const tasks = aiResponse.pillars.map((p, index) => ({
      plan_id: plan.id,
      day_number: index + 1,
      task_title: p.title,
      task_description: p.huge_text
    }));

    const { data: savedTasks, error: taskError } = await supabase.from('daily_tasks').insert(tasks).select();

    if (taskError) {
      console.error('⚠️ Warning: Failed to save tasks to DB, but continuing...', taskError.message);
    }

    res.json({ success: true, data: { plan, cards: savedTasks || tasks, full_ai: aiResponse } });


  } catch (error) {
    console.error('❌ Generation Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Fetch Manifestation History (Vision Board) ───────────────────────────
app.get('/api/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[HISTORY] Fetching history for user ID: ${userId}`);

    // 1. Fetch manifestations manually
    const { data: manifestations, error: manError } = await supabase
      .from('manifestations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (manError) throw manError;

    const historyData = manifestations || [];

    // 2. Fetch plans and tasks manually (Bulletproof JOIN bypass)
    for (let man of historyData) {
      const { data: plans } = await supabase
        .from('manifestation_plans')
        .select('*')
        .eq('manifestation_id', man.id);

      man.manifestation_plans = plans || [];

      for (let plan of man.manifestation_plans) {
        const { data: tasks } = await supabase
          .from('daily_tasks')
          .select('*')
          .eq('plan_id', plan.id)
          .order('day_number', { ascending: true });

        plan.daily_tasks = tasks || [];
      }
    }

    console.log(`[HISTORY] Found ${historyData.length} items for user.`);
    res.json({ success: true, data: historyData });

  } catch (error) {
    console.error('[HISTORY ERROR]:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Delete Manifestation (Permanent) ────────────────────────────────────────
app.delete('/api/manifestations/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[DELETE] Manifest ID: ${id}`);

  try {
    // 1. Find the plan linked to this manifestation
    const { data: plans } = await supabase
      .from('manifestation_plans')
      .select('id')
      .eq('manifestation_id', id);

    if (plans && plans.length > 0) {
      const planIds = plans.map(p => p.id);

      // 2. Delete daily_tasks for all related plans
      await supabase.from('daily_tasks').delete().in('plan_id', planIds);

      // 3. Delete the plans themselves
      await supabase.from('manifestation_plans').delete().eq('manifestation_id', id);
    }

    // 4. Delete the root manifestation
    const { error } = await supabase.from('manifestations').delete().eq('id', id);
    if (error) throw error;

    console.log(`[DELETE] ✅ Manifestation ${id} wiped from cosmos.`);
    res.json({ success: true, message: 'Manifestation permanently removed.' });
  } catch (error) {
    console.error('[DELETE ERROR]:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Backend listening at http://localhost:${port}`);
});

