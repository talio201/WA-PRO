const { isAdminEmail } = require('../config/adminStore');

function isTruthy(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'admin';
}

function userHasAdminFlag(user = {}) {
  return (
    isTruthy(user?.user_metadata?.isAdmin)
    || isTruthy(user?.user_metadata?.is_admin)
    || isTruthy(user?.app_metadata?.isAdmin)
    || isTruthy(user?.app_metadata?.is_admin)
    || String(user?.app_metadata?.role || '').trim().toLowerCase() === 'admin'
    || String(user?.user_metadata?.role || '').trim().toLowerCase() === 'admin'
  );
}

function canAccessAdmin(req) {
  if (!req?.user) return false;
  const email = String(req.user.email || '').trim().toLowerCase();
  if (userHasAdminFlag(req.user)) return true;
  if (isAdminEmail(email)) return true;
  return false;
}

function requireAdminAccess(req, res, next) {
  if (!canAccessAdmin(req)) {
    return res.status(403).json({ msg: 'Admin access required.' });
  }
  return next();
}

module.exports = {
  requireAdminAccess,
  canAccessAdmin,
};
