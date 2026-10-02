/** Tiny typed-ish event bus for gameplay notifications (tutorial, UI, audio). */
export type GameEventName =
  | 'coverEnter' | 'weaponFired' | 'weaponSwap' | 'powerCast' | 'primed' | 'combo'
  | 'pullBlocked' | 'playerDied' | 'enemyKilled' | 'sectionStart' | 'encounterStart'
  | 'encounterClear' | 'dialogueEnd' | 'bossPhase' | 'bossDefeated' | 'checkpoint';

type Handler = (arg?: unknown) => void;

export class EventBus {
  private readonly handlers = new Map<string, Handler[]>();

  on(name: GameEventName, h: Handler): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(h);
    this.handlers.set(name, list);
    return () => {
      const l = this.handlers.get(name);
      if (l) l.splice(l.indexOf(h), 1);
    };
  }

  emit(name: GameEventName, arg?: unknown): void {
    const list = this.handlers.get(name);
    if (!list) return;
    for (const h of [...list]) h(arg);
  }
}
