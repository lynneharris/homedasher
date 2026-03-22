// api/submit.js
// Handles booking form submission:
// 1. Creates/updates customer in Supabase
// 2. Creates client + job in Jobber
// 3. Saves chore list as Jobber note
// 4. Charges customer via Stripe
// 5. Creates visit record + task list in Supabase
// 6. Saves/updates household profile (access, pets)
// 7. Sends confirmation to customer (email or SMS) with dashboard link
// 8. Notifies admin

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../lib/supabase');
const { createJobberClient, createJobberJob, addClientNote } = require('../lib/jobber');
const { notifyCustomer, notifyAdmin, emailAdmin } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, email, phone, address, notes,
      choreList, contactPreference,
      date, time, duration, // hours e.g. 2.5
      paymentMethodId, promoCode,
      // Home access (new)
      accessMethod,       // 'someone_home' | 'buzzer' | 'independent'
      arrivalPreference,  // 'call' | 'text' | 'ring_bell' | 'enter' (if someone home)
      accessDetails,      // freeform: codes, key location, gate info
      // Pets (new)
      hasPets,            // boolean
      petNotes,           // freeform
      // Task list as structured array (new) — falls back to choreList string
      taskList,           // [{ title, category, priority, notes }]
    } = req.body;

    // --- 1. Calculate price ---
    const hourlyRate = parseFloat(process.env.HOURLY_RATE) || 50;
    let totalCents = Math.round(duration * hourlyRate * 100);
    let discountCents = 0;
    let stripePromoId = null;

    // Apply promo code if provided
    if (promoCode) {
      const promos = await stripe.promotionCodes.list({ code: promoCode, active: true });
      if (promos.data.length > 0) {
        const promo = promos.data[0];
        stripePromoId = promo.id;
        const coupon = promo.coupon;
        if (coupon.percent_off) {
          discountCents = Math.round(totalCents * coupon.percent_off / 100);
        } else if (coupon.amount_off) {
          discountCents = coupon.amount_off;
        }
        totalCents = Math.max(totalCents - discountCents, 0);
      }
    }

    // Apply recurring discount if returning customer
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .eq('email', email)
      .single();

    const recurringDiscountPercent = parseFloat(process.env.RECURRING_DISCOUNT_PERCENT) || 10;
    let isRecurring = false;
    if (existingCustomer?.booking_count > 0) {
      isRecurring = true;
      const recurringDiscount = Math.round(totalCents * recurringDiscountPercent / 100);
      totalCents = Math.max(totalCents - recurringDiscount, 0);
    }

    // Apply referral credit if customer has one
    let referralCredit = 0;
    if (existingCustomer?.referral_credit_cents > 0) {
      referralCredit = Math.min(existingCustomer.referral_credit_cents, totalCents);
      totalCents = Math.max(totalCents - referralCredit, 0);
    }

    // --- 2. Charge customer via Stripe ---
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        customerEmail: email,
        jobDate: date,
        jobTime: time,
        duration: duration.toString(),
        promoCode: promoCode || '',
      },
    });

    if (paymentIntent.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed. Please check your card details.' });
    }

    // --- 3. Create or update customer in Supabase ---
    const bookingCount = (existingCustomer?.booking_count || 0) + 1;
    const { data: customer } = await supabase
      .from('customers')
      .upsert({
        email,
        name,
        phone,
        address,
        contact_preference: contactPreference || 'email',
        booking_count: bookingCount,
        referral_credit_cents: (existingCustomer?.referral_credit_cents || 0) - referralCredit,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' })
      .select()
      .single();

    // --- 4. Save chore list in Supabase ---
    await supabase.from('chore_lists').upsert({
      customer_email: email,
      content: choreList,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_email' });

    // --- 5. Create client + job in Jobber ---
    let jobberClientId = existingCustomer?.jobber_client_id;
    let jobberPropertyId = existingCustomer?.jobber_property_id;

    if (!jobberClientId) {
      const nameParts = name.split(' ');
      const jobberClient = await createJobberClient({
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        email,
        phone,
        address,
      });
      jobberClientId = jobberClient.id;
      jobberPropertyId = jobberClient.propertyId;

      // Save Jobber client ID and property ID back to Supabase
      await supabase
        .from('customers')
        .update({
          jobber_client_id: jobberClientId,
          jobber_property_id: jobberPropertyId,
        })
        .eq('email', email);
    }

    // Create job in Jobber
    const startAt = new Date(`${date}T${time}`).toISOString();
    const jobberJob = await createJobberJob({
      propertyId: jobberPropertyId,
      title: `HomeDasher Clean — ${name}`,
      instructions: `${choreList}\n\nCustomer notes: ${notes || 'None'}\nAddress: ${address}`,
      startAt,
      duration,
    });

    // Save chore list as note on Jobber client
    await addClientNote({
      clientId: jobberClientId,
      note: `CHORE LIST (${new Date().toLocaleDateString()}):\n${choreList}`,
    });

    // --- 6. Save booking in Supabase ---
    const { data: booking } = await supabase
      .from('bookings')
      .insert({
        customer_email: email,
        jobber_job_id: jobberJob.id,
        stripe_payment_intent_id: paymentIntent.id,
        date,
        time,
        duration,
        amount_cents: totalCents,
        discount_cents: discountCents,
        referral_credit_cents: referralCredit,
        status: 'unassigned',
        promo_code: promoCode || null,
        is_recurring: isRecurring,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Deduct referral credit if used
    if (referralCredit > 0) {
      await supabase
        .from('customers')
        .update({ referral_credit_cents: 0 })
        .eq('email', email);
    }

    // --- 6b. Save/update household profile (access + pets) ---
    await supabase.from('household_profile').upsert({
      customer_email: email,
      access_method: accessMethod || null,
      arrival_preference: arrivalPreference || null,
      access_details: accessDetails || null,
      pets: hasPets || false,
      pet_notes: petNotes || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_email' });

    // --- 6c. Create visit record ---
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    const durationMinutes = Math.round(parseFloat(duration) * 60);

    const { data: visit } = await supabase
      .from('visits')
      .insert({
        customer_email: email,
        booking_id: booking.id,
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        status: 'upcoming',
        access_method: accessMethod || null,
        access_details: accessDetails || null,
        arrival_preference: arrivalPreference || null,
      })
      .select()
      .single();

    // --- 6d. Create task records from structured taskList or parse choreList ---
    const tasksToInsert = [];

    if (taskList && Array.isArray(taskList) && taskList.length > 0) {
      // New structured format from updated booking UI
      taskList.forEach((task, i) => {
        tasksToInsert.push({
          customer_email: email,
          visit_id: task.assignedTo === 'dasher' ? visit.id : null,
          member_id: null, // member tasks created separately in dashboard
          category: task.assignedTo === 'dasher' ? (task.category || 'upcoming') : null,
          title: task.title,
          notes: task.notes || null,
          priority: task.priority || 'medium',
          sort_order: i,
          done: false,
        });
      });
    } else if (choreList) {
      // Legacy: parse the AI-generated text chore list into task rows
      const lines = choreList.split('\n').filter(l => l.trim());
      let sortOrder = 0;
      let currentCategory = 'upcoming';
      for (const line of lines) {
        if (line.includes('If time allows')) { currentCategory = 'future'; continue; }
        const match = line.match(/^\s*[\d\-\*•]\s*(.+)/);
        if (match) {
          const title = match[1].replace(/\s*—.*$/, '').trim();
          if (title.length > 2) {
            tasksToInsert.push({
              customer_email: email,
              visit_id: visit.id,
              category: currentCategory,
              title,
              priority: currentCategory === 'upcoming' ? 'high' : 'medium',
              sort_order: sortOrder++,
              done: false,
            });
          }
        }
      }
    }

    if (tasksToInsert.length > 0) {
      await supabase.from('tasks').insert(tasksToInsert);
    }

    // --- 7. Send confirmation to customer ---
    const formattedDate = new Date(`${date}T${time}`).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
    const formattedTime = new Date(`${date}T${time}`).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit'
    });
    const formattedTotal = `$${(totalCents / 100).toFixed(2)}`;

    const dashboardLink = `${process.env.APP_URL}/dashboard`;

    await notifyCustomer({
      preference: contactPreference,
      email,
      phone,
      subject: 'Your HomeDasher booking is confirmed! ✨',
      message: `Hi ${name.split(' ')[0]}! Your clean is booked for ${formattedDate} at ${formattedTime} (${duration} hrs). Total charged: ${formattedTotal}. View your visit details and to-do list anytime at: ${dashboardLink} — We'll notify you when a HomeDasher is assigned!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Booking Confirmed! ✨</h1>
          </div>
          <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px;">Hi ${name.split(' ')[0]}! Your HomeDasher clean is all set.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Date</td><td style="padding: 8px 0; color: #0e4f5c; font-weight: bold;">${formattedDate}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Time</td><td style="padding: 8px 0; color: #0e4f5c; font-weight: bold;">${formattedTime}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Duration</td><td style="padding: 8px 0; color: #0e4f5c; font-weight: bold;">${duration} hours</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Address</td><td style="padding: 8px 0; color: #0e4f5c; font-weight: bold;">${address}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total charged</td><td style="padding: 8px 0; color: #0e4f5c; font-weight: bold;">${formattedTotal}</td></tr>
            </table>
            <a href="${dashboardLink}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #0e7490); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; margin: 8px 0;">View My Visit & To-Do List →</a>
            <p style="color: #475569; font-size: 14px; margin-top: 16px;">We'll send you another message when your HomeDasher is assigned. Cancel anytime before your appointment for a full refund.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
          </div>
        </div>
      `,
    });

    // --- 8. Notify admin ---
    await notifyAdmin(
      `New booking! ${name} on ${formattedDate} at ${formattedTime} (${duration}hrs) — ${address}. Job #${jobberJob.jobNumber}. Amount: ${formattedTotal}`
    );

    return res.status(200).json({
      success: true,
      bookingId: booking.id,
      visitId: visit?.id,
      visitToken: visit?.visit_token,
      jobberJobNumber: jobberJob.jobNumber,
      amountCharged: totalCents,
    });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'Booking failed. Please try again.' });
  }
};
