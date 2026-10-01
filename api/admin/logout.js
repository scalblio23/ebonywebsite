// POST /api/admin/logout — clears the admin session cookie.
const { clearCookie } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookie());
  return res.status(200).json({ ok: true });
};
