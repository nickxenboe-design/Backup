import { requireAgentAuth } from './userAuth.js';
import { getAgentByEmail } from '../services/agent.service.js';

export const requireAgentApi = [
  requireAgentAuth,
  async (req, res, next) => {
    try {
      const email = req.user && req.user.email;
      if (!email) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
      }

      const agent = await getAgentByEmail(email);

      if (!agent || agent.active === false) {
        return res.status(403).json({ success: false, error: 'AGENT_NOT_REGISTERED' });
      }

      req.agent = agent;
      // Tag downstream for logging/reporting
      req.agentId = agent.id;
      req.agentEmail = agent.emailLower || email.toLowerCase();
      return next();
    } catch (err) {
      return res.status(500).json({ success: false, error: 'AGENT_CHECK_FAILED', message: err.message });
    }
  }
];
