// api/chat.js
// Proxies AI chat requests to Anthropic
// Keeps your API key secure on the server

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a friendly cleaning assistant for HomeDasher, a professional home cleaning service. Help customers build a personalized cleaning plan for their home.

Start with a warm 1-2 sentence greeting, then gather info with no more than 2 questions at a time:
- How many bedrooms and bathrooms?
- Standard clean or deep clean?
- Any priorities or concerns (pet hair, kitchen grease, move-out, etc.)?
- Anything to skip?

After 2-3 exchanges when you have enough info, generate a chore list using EXACTLY this format:

**Your Custom Cleaning Plan**

**Kitchen**
- Wipe down countertops and backsplash
- Clean stovetop and appliance exteriors
- Scrub sink and faucet

**Bathrooms**
- Scrub and sanitize toilet
- Clean mirrors and counters
- Scrub shower/tub

(continue for Living Room, Bedrooms, and any other relevant rooms)

After the list, end with: "Looks good? Click the button below to book your cleaning!"

Stay warm, confident, and brief. No walls of text.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    return res.status(200).json({
      message: response.content[0].text,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Chat failed. Please try again.' });
  }
};
