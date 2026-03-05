// api/availability.js
// Returns available start times for a given date and duration
// Rules:
// - Working hours: 10am-2pm Mon-Fri
// - Start times in 30-minute increments
// - 30-minute travel buffer between jobs
// - Minimum 1 hour booking notice
// - Start times only shown if enough time remains to complete the booking

const { getJobsForDate } = require('../lib/jobber');

const WORK_START = 10 * 60; // 10:00am in minutes
const WORK_END = 14 * 60;   // 2:00pm in minutes
const BUFFER_MINS = 30;
const INCREMENT_MINS = 30;
const MIN_NOTICE_MINS = 60;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { date, duration } = req.query;
    if (!date || !duration) return res.status(400).json({ error: 'date and duration required' });

    const durationMins = Math.round(parseFloat(duration) * 60);
    const requestedDate = new Date(date + 'T00:00:00');

    // Check if date is a weekday
    const dayOfWeek = requestedDate.getDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.status(200).json({ slots: [], reason: 'Weekends not available' });
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestedDate < today) {
      return res.status(200).json({ slots: [], reason: 'Date is in the past' });
    }

    // Get existing jobs from Jobber for this date
    let existingJobs = [];
    try {
      existingJobs = await getJobsForDate(date);
    } catch (err) {
      // If Jobber isn't connected yet, proceed with no existing jobs
      console.warn('Jobber unavailable, proceeding without existing jobs:', err.message);
    }

    // Convert existing jobs to blocked time ranges (with buffer on each side)
    // One worker at a time — any existing job blocks overlapping slots
    const blockedRanges = existingJobs.map(job => {
      const start = timeToMins(job.startAt);
      const end = timeToMins(job.endAt);
      return {
        start: start - BUFFER_MINS,
        end: end + BUFFER_MINS,
      };
    });

    // Generate all possible start times in 30-min increments
    const now = new Date();
    const isToday = date === now.toISOString().split('T')[0];
    const currentMins = isToday ? now.getHours() * 60 + now.getMinutes() + MIN_NOTICE_MINS : 0;

    const slots = [];
    for (let start = WORK_START; start + durationMins <= WORK_END; start += INCREMENT_MINS) {
      const end = start + durationMins;

      // Skip if too soon (today only)
      if (isToday && start < currentMins) continue;

      // Skip if overlaps any blocked range
      const blocked = blockedRanges.some(range => start < range.end && end > range.start);
      if (blocked) continue;

      slots.push(minsToTime(start));
    }

    return res.status(200).json({ slots });

  } catch (err) {
    console.error('Availability error:', err);
    return res.status(500).json({ error: 'Failed to load availability.' });
  }
};

function timeToMins(isoString) {
  const d = new Date(isoString);
  return d.getHours() * 60 + d.getMinutes();
}

function minsToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h > 12 ? h - 12 : h;
  const min = m === 0 ? '00' : m;
  return { display: `${hour}:${min} ${ampm}`, value: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
}
