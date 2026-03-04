-- =============================================
-- HomeDasher Supabase Database Schema
-- Run this in your Supabase SQL editor
-- =============================================

-- Customers table
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  contact_preference TEXT DEFAULT 'email' CHECK (contact_preference IN ('email', 'sms')),
  booking_count INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
  referral_credit_cents INTEGER DEFAULT 0,
  referred_by TEXT,
  jobber_client_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Chore lists table (one per customer, upserted on each booking)
CREATE TABLE chore_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_email TEXT UNIQUE REFERENCES customers(email),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Magic link tokens
CREATE TABLE magic_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  customer_email TEXT REFERENCES customers(email),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bookings table
CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_email TEXT REFERENCES customers(email),
  jobber_job_id TEXT,
  jobber_job_number TEXT,
  stripe_payment_intent_id TEXT,
  stripe_payment_method_id TEXT,
  stripe_tip_payment_intent_id TEXT,
  worker_id UUID REFERENCES workers(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration NUMERIC NOT NULL,
  amount_cents INTEGER NOT NULL,
  discount_cents INTEGER DEFAULT 0,
  referral_credit_cents INTEGER DEFAULT 0,
  tip_cents INTEGER DEFAULT 0,
  promo_code TEXT,
  is_recurring BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'complete', 'cancelled', 'rated')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  alert_sent BOOLEAN DEFAULT false,
  cancel_notified BOOLEAN DEFAULT false,
  cancel_reason TEXT,
  assigned_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Workers table
CREATE TABLE workers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  tier TEXT DEFAULT 'trial' CHECK (tier IN ('trial', 'vetted')),
  jobber_worker_id TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Job requests (trial workers requesting jobs, pending owner approval)
CREATE TABLE job_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id UUID REFERENCES workers(id),
  worker_name TEXT,
  jobber_job_id TEXT,
  booking_id UUID REFERENCES bookings(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ratings table
CREATE TABLE ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id),
  customer_email TEXT REFERENCES customers(email),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Referrals table
CREATE TABLE referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_email TEXT REFERENCES customers(email),
  referee_email TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  credit_cents INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  credited_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_referral_code ON customers(referral_code);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_customer ON bookings(customer_email);
CREATE INDEX idx_magic_tokens_token ON magic_tokens(token);
CREATE INDEX idx_magic_tokens_expires ON magic_tokens(expires_at);
CREATE INDEX idx_job_requests_status ON job_requests(status);

-- Auto-clean expired magic tokens daily (optional Supabase cron)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('clean-expired-tokens', '0 0 * * *', $$
--   DELETE FROM magic_tokens WHERE expires_at < now();
-- $$);
