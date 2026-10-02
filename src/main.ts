import './ui/style.css';
import { Game } from './game/Game';
import { UI } from './strings';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const loading = document.getElementById('loading')!;
  const fill = document.getElementById('loading-fill')!;
  document.getElementById('loading-text')!.textContent = UI.loading;
  const game = new Game(app, ui);
  // The canvas goes under the UI layer.
  await game.init((p) => {
    fill.style.transform = `scaleX(${p})`;
  });
  app.insertBefore(game.renderer.canvas, ui);
  loading.classList.add('done');
  game.begin();
  game.run();
}

boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Failed to start: ${(e as Error).message}`;
});
