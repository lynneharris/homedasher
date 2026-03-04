// api/webhook.js
// Stripe webhook handler
// Listens for payment events and job completion triggers
// Set this URL in your Stripe dashboard: https://homedasher.net/api/webhook

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../lib/supabase');
const { notifyCustomer } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify the event came from Stripe
    event = stripe.webhooks.constructEvent(
      req.body, // must be raw buffer — see index.js for bodyParser config
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        // Payment confirmed — booking is live
        const pi = event.data.object;
        await supabase
          .from('bookings')
          .update({ payment_status: 'paid' })
          .eq('stripe_payment_intent_id', pi.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        // Payment failed — update booking and alert customer
        const pi = event.data.object;
        const { data: booking } = await supabase
          .from('bookings')
          .update({ payment_status: 'failed', status: 'cancelled' })
          .eq('stripe_payment_intent_id', pi.id)
          .select('*, customers(*)')
          .single();

        if (booking?.customers) {
          await notifyCustomer({
            preference: booking.customers.contact_preference,
            email: booking.customers.email,
            phone: booking.customers.phone,
            subject: 'Payment issue with your HomeDasher booking',
            message: `Hi ${booking.customers.name.split(' ')[0]}, there was an issue processing your payment. Your booking has been cancelled. Please visit homedasher.net to try again.`,
            html: `<p>Hi ${booking.customers.name.split(' ')[0]}, there was an issue processing your payment and your booking has been cancelled. Please <a href="${process.env.APP_URL}">visit HomeDasher</a> to try again.</p>`,
          });
        }
        break;
      }

      case 'charge.refunded': {
        // Refund confirmed — update booking
        const charge = event.data.object;
        await supabase
          .from('bookings')
          .update({ payment_status: 'refunded' })
          .eq('stripe_payment_intent_id', charge.payment_intent);
        break;
      }

      default:
        // Ignore other event types
        break;
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
