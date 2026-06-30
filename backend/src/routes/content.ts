import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireRoles('admin', 'manager', 'employee'));

const CONTENT_PROMPTS: Record<string, string> = {
  blog_post:    'Write a well-structured, engaging blog post with a title, introduction, body sections, and conclusion',
  instagram:    'Write an engaging Instagram caption with relevant hashtags',
  facebook:     'Write a Facebook post that drives engagement',
  twitter:      'Write a punchy Twitter/X post (strictly under 280 characters)',
  linkedin:     'Write a professional LinkedIn post that builds thought leadership',
  email:        'Write a professional email including a subject line on the first line followed by the email body',
  whatsapp:     'Write a concise, friendly WhatsApp broadcast message',
  ad_copy:      'Write compelling ad copy with a headline, body, and call-to-action',
  seo_meta:     'Write an SEO-optimised meta title (under 60 characters) and meta description (under 160 characters) as two clearly labelled lines',
  newsletter:   'Write an engaging newsletter section with a catchy heading and body copy',
};

router.post('/generate', async (req: AuthRequest, res: Response) => {
  const { keywords, content_type, tone, extra_context } = req.body;

  if (!keywords?.length || !content_type) {
    res.status(400).json({ error: 'Keywords and content_type are required' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not set in .env — get a free key at aistudio.google.com' });
    return;
  }

  const keywordList = (Array.isArray(keywords) ? keywords : [keywords]).join(', ');
  const contentPrompt = CONTENT_PROMPTS[content_type] ?? `Write ${content_type} content`;

  const prompt = [
    `${contentPrompt} with a ${tone ?? 'professional'} tone.`,
    `Keywords to incorporate: ${keywordList}.`,
    extra_context ? `Additional context: ${extra_context}` : '',
    'Output only the final content — no meta-commentary, no explanations, no markdown code fences.',
  ].filter(Boolean).join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.8 },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('Gemini API error:', errBody);
      res.status(500).json({ error: 'AI generation failed — check your API key' });
      return;
    }

    const data = await response.json() as any;
    const content: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.json({ content });
  } catch (err) {
    console.error('Content generation error:', err);
    res.status(500).json({ error: 'Failed to reach AI service' });
  }
});

export default router;
