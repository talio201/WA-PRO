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
  const status = String(req?.saasUser?.status || 'pending').trim().toLowerCase();
  const expiresAt = req?.saasUser?.expiresAt ? new Date(req.saasUser.expiresAt).getTime() : 0;
  const access = req?.saasUser?.metadata?.access || {};
  const email = String(req.user.email || '').trim().toLowerCase();
  const hasLegacyAdminTrust = userHasAdminFlag(req.user) || isAdminEmail(email);
  const hasExplicitAdminGate = access?.allowAdmin === true;
  const hasImplicitLegacyAdminGate = access?.allowAdmin === undefined && hasLegacyAdminTrust;
  const hasAdminGate = hasExplicitAdminGate || hasImplicitLegacyAdminGate;
  if (status !== 'active') return false;
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) return false;
  if (!hasAdminGate) return false;
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
