import { CONFIG } from '../config';
import { DIALOGUE, SPEAKERS, UI } from '../strings';
import { evalCondition, type DialogueChoice, type DialogueNode, type DialogueTree, type SpeakerId } from '../dialogue/types';
import type { Game } from '../game/Game';
import { glyph } from './glyph';

/**
 * Runs a dialogue tree: speaker name, skippable typewriter text, 2-4
 * choices usable with mouse, keyboard (arrows/W/S, 1-4, Enter/Space/E) and
 * gamepad (D-pad/stick + A). Fires node/choice flags and events.
 */
export class DialogueUI {
  private readonly root: HTMLDivElement;
  private readonly speakerEl: HTMLDivElement;
  private readonly lineEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  private readonly advanceEl: HTMLDivElement;
  private tree: DialogueTree | null = null;
  private node: DialogueNode | null = null;
  /** Current node id (tests/debug). */
  nodeId = '';
  private shown = 0;
  private typing = false;
  private visibleChoices: DialogueChoice[] = [];
  private focus = 0;
  private onEnd: (() => void) | null = null;
  private blipAcc = 0;
  private inputGrace = 0;
  active = false;
  /** Node ids visited, for tests. */
  readonly history: string[] = [];

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dialogue';
    this.root.innerHTML = '<div class="letterbox-top"></div>';
    this.speakerEl = document.createElement('div');
    this.speakerEl.className = 'speaker';
    this.lineEl = document.createElement('div');
    this.lineEl.className = 'line';
    this.choicesEl = document.createElement('div');
    this.choicesEl.className = 'choices';
    this.advanceEl = document.createElement('div');
    this.advanceEl.className = 'advance';
    this.root.append(this.speakerEl, this.lineEl, this.choicesEl, this.advanceEl);
    parent.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      // Clicking the text area skips/advances (choices handle their own clicks).
      if ((e.target as HTMLElement).closest('.choice')) return;
      if (e.button === 0) this.confirm();
    });
    game.input.onDeviceChange(() => this.renderAdvance());
  }

  start(id: string, onEnd: () => void): void {
    const tree = DIALOGUE[id];
    if (!tree) throw new Error(`No dialogue tree ${id}`);
    this.tree = tree;
    this.onEnd = onEnd;
    this.active = true;
    this.history.length = 0;
    this.root.classList.add('show');
    this.inputGrace = 0.25;
    this.enter(tree.start);
  }

  get partner(): SpeakerId | null {
    return this.tree?.partner ?? null;
  }

  get currentSpeaker(): SpeakerId | null {
    return this.node?.speaker ?? null;
  }

  private enter(id: string | null): void {
    if (!this.tree || id === null) {
      this.finish();
      return;
    }
    const node = this.tree.nodes[id];
    this.nodeId = id;
    this.node = node;
    this.history.push(id);
    for (const f of node.setFlags ?? []) this.game.director.flags.add(f);
    for (const ev of node.events ?? []) this.pendingEvents.push(ev);
    this.shown = 0;
    this.typing = true;
    this.speakerEl.textContent = SPEAKERS[node.speaker];
    this.speakerEl.className = `speaker ${node.speaker}`;
    this.lineEl.textContent = '';
    this.choicesEl.innerHTML = '';
    this.visibleChoices = (node.choices ?? []).filter((c) => !c.condition || evalCondition(c.condition, this.game.director.flags));
    this.focus = 0;
    this.renderAdvance();
    this.game.onDialogueLine(node.speaker);
  }

  private pendingEvents: NonNullable<DialogueNode['events']> = [];

  private renderChoices(): void {
    this.choicesEl.innerHTML = '';
    this.visibleChoices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = `choice${i === this.focus ? ' focus' : ''}`;
      b.innerHTML = `<span class="n">${i + 1}</span><span>${escapeHtml(c.text)}</span>`;
      b.addEventListener('mouseenter', () => this.setFocus(i));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.choose(i);
      });
      this.choicesEl.appendChild(b);
    });
  }

  private setFocus(i: number): void {
    if (i === this.focus) return;
    this.focus = i;
    this.choicesEl.querySelectorAll('.choice').forEach((el, k) => el.classList.toggle('focus', k === i));
    this.game.audio.play('uiMove');
  }

  private renderAdvance(): void {
    if (!this.node) return;
    const d = this.game.input.device;
    if (this.typing) {
      this.advanceEl.innerHTML = `<span>${glyph('uiConfirm', d)}${UI.skip}</span>`;
    } else if (this.visibleChoices.length) {
      this.advanceEl.innerHTML = d === 'gamepad'
        ? `<span>${glyph('uiUp', d)}${glyph('uiDown', d)}</span><span>${glyph('uiConfirm', d)}Choose</span>`
        : '<span><span class="key">1</span>–<span class="key">4</span> or <span class="key">↑</span><span class="key">↓</span> <span class="key">Enter</span></span>';
    } else {
      this.advanceEl.innerHTML = `<span>${glyph('uiConfirm', d)}${UI.continueDialogue}</span>`;
    }
  }

  private confirm(): void {
    if (!this.node) return;
    if (this.typing) {
      this.shown = this.node.text.length;
      return;
    }
    if (this.visibleChoices.length) {
      this.choose(this.focus);
      return;
    }
    this.game.audio.play('uiMove');
    this.advance();
  }

  private advance(): void {
    const n = this.node!;
    this.flushEvents();
    for (const b of n.branches ?? []) {
      if (evalCondition(b.condition, this.game.director.flags)) {
        this.enter(b.next);
        return;
      }
    }
    this.enter(n.next ?? null);
  }

  private choose(i: number): void {
    const c = this.visibleChoices[i];
    if (!c || this.typing) return;
    this.game.audio.play('uiSelect');
    for (const f of c.setFlags ?? []) this.game.director.flags.add(f);
    for (const ev of c.events ?? []) this.pendingEvents.push(ev);
    this.flushEvents();
    this.enter(c.next);
  }

  private flushEvents(): void {
    const evs = this.pendingEvents.splice(0);
    for (const ev of evs) this.game.director.onDialogueEvent(ev);
  }

  private finish(): void {
    this.flushEvents();
    this.active = false;
    this.tree = null;
    this.node = null;
    this.root.classList.remove('show');
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  /** Programmatic choice (debug / automated playthrough). */
  autoAdvance(choiceIndex = 0): void {
    if (!this.node) return;
    if (this.typing) this.shown = this.node.text.length;
    this.update(0);
    if (this.visibleChoices.length) this.choose(Math.min(choiceIndex, this.visibleChoices.length - 1));
    else this.advance();
  }

  update(dt: number): void {
    if (!this.active || !this.node) return;
    const input = this.game.input;
    this.inputGrace -= dt;
    if (this.typing) {
      const before = Math.floor(this.shown);
      this.shown = Math.min(this.node.text.length, this.shown + dt * CONFIG.ui.typewriterCps);
      const now = Math.floor(this.shown);
      if (now !== before) {
        this.lineEl.textContent = this.node.text.slice(0, now);
        this.blipAcc += now - before;
        if (this.blipAcc >= 3) {
          this.blipAcc = 0;
          this.game.audio.play('typeBlip');
        }
      }
      if (this.shown >= this.node.text.length) {
        this.typing = false;
        this.lineEl.textContent = this.node.text;
        this.renderChoices();
        this.renderAdvance();
      }
    }
    if (this.inputGrace > 0) return;
    if (input.pressed('uiConfirm') || input.pressed('fire')) {
      this.confirm();
      return;
    }
    if (!this.typing && this.visibleChoices.length) {
      const n = this.visibleChoices.length;
      if (input.pressed('uiDown')) this.setFocus((this.focus + 1) % n);
      if (input.pressed('uiUp')) this.setFocus((this.focus + n - 1) % n);
      const nums = ['choice1', 'choice2', 'choice3', 'choice4'] as const;
      nums.forEach((a, i) => {
        if (input.pressed(a) && i < n) this.choose(i);
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
