import type { QualityLevel } from '../config';
import type { Game } from '../game/Game';
import type { Avatar } from './types';
import { CapsuleAvatar } from './CapsuleAvatar';

/** The one entry point gameplay uses to get the protagonist's visual. */
export async function createAvatar(_game: Game, _quality: QualityLevel): Promise<Avatar> {
  return new CapsuleAvatar();
}
