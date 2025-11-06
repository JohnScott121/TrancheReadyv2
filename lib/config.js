export const cfg = {
  PORT: parseInt(process.env.PORT || '10000', 10),
  APP_ORIGIN: process.env.APP_ORIGIN || 'http://localhost:10000',
  MARKETING_ORIGIN: process.env.MARKETING_ORIGIN || 'http://localhost:5500',
  VERIFY_TTL_MIN: parseInt(process.env.VERIFY_TTL_MIN || '60', 10),

  SIGN_PRIVATE_KEY: process.env.SIGN_PRIVATE_KEY || '',
  SIGN_PUBLIC_KEY: process.env.SIGN_PUBLIC_KEY || '',

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_PRICE_ID_TEAM: process.env.STRIPE_PRICE_ID_TEAM || '',
  STRIPE_PRICE_ID_STARTER: process.env.STRIPE_PRICE_ID_STARTER || ''
};
