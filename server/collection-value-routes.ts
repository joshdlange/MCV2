import type { Express, RequestHandler } from 'express';
import { canViewTopCards, getCollectionValue, parseCollectionValueOptions } from './services/collectionValue';

type AccessResolver = (username: string, callerId?: number) => Promise<
  { ok: false; status: number; message: string } |
  { ok: true; targetUser: { id: number; showCollection: boolean; profileVisibility: string | null }; isOwnProfile: boolean }
>;

export function registerCollectionValueRoutes(app: Express, authenticate: RequestHandler, resolveAccess: AccessResolver) {
  const serve = async (req: any, res: any, userId: number) => {
    let options;
    try { options = parseCollectionValueOptions(req.query); }
    catch (error) { return res.status(400).json({ message: (error as Error).message }); }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getCollectionValue(userId, options));
  };
  app.get('/api/collection/value', authenticate, async (req: any, res) => {
    try {
      await serve(req, res, req.user.id);
    } catch (error) {
      console.error('[Collection Value]', error);
      res.status(500).json({ message: 'Unable to load collection values' });
    }
  });
  app.get('/api/collectors/:username/top-cards', authenticate, async (req: any, res) => {
    try {
      const access = await resolveAccess(req.params.username, req.user.id);
      if (!access.ok) return res.status(access.status).json({ message: access.message });
      if (!canViewTopCards(access.targetUser, access.isOwnProfile)) {
        return res.status(403).json({ message: 'This collector keeps their collection values private' });
      }
      await serve(req, res, access.targetUser.id);
    } catch (error) {
      console.error('[Collector Top Cards]', error);
      res.status(500).json({ message: 'Unable to load top cards' });
    }
  });
}
