import type { QualityLevel } from '../config';
import type { Game } from '../game/Game';
import type { Avatar } from './types';
import { Protagonist } from './protagonist/Protagonist';

/** The one entry point gameplay uses to get the protagonist's visual. */
export async function createAvatar(game: Game, quality: QualityLevel): Promise<Avatar> {
  return new Protagonist(game, quality);
}
