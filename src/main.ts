import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/chakra-petch/700-italic.css';
import './styles/main.css';
import { Game } from './game/Game';
import { webglAvailable } from './rendering/Renderer';
import { preloadCarModels } from './vehicles/CarAssets';
import { preloadAssetPack } from './tracks/AssetPack';

const loader = document.getElementById('boot-loader')!;
const fill = document.getElementById('boot-fill')!;
const text = document.getElementById('boot-text')!;

function progress(p: number, msg: string): Promise<void> {
  fill.style.width = `${Math.round(p * 100)}%`;
  text.textContent = msg;
  // Yield so the browser can paint the loader between heavy steps.
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function fatal(title: string, detail: string): void {
  loader.classList.add('error');
  loader.innerHTML = `<div class="boot-logo">NITRO<span>FRONTIER</span></div>
    <div class="boot-error"><h2>${title}</h2><p>${detail}</p></div>`;
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    fatal('WebGL is not available',
      'Nitro Frontier needs WebGL to render 3D graphics. Please use an up-to-date Chrome or Firefox, ' +
      'enable hardware acceleration in your browser settings, and update your graphics drivers.');
    return;
  }
  try {
    await progress(0.08, 'Loading car models…');
    const models = await preloadCarModels((d, t) => {
      fill.style.width = `${Math.round(8 + (d / Math.max(1, t)) * 7)}%`;
    });
    if (models.length) console.info(`[models] using imported models for: ${models.join(', ')}`);
    await progress(0.12, 'Loading skies and textures…');
    await preloadAssetPack((d, t) => {
      fill.style.width = `${Math.round(12 + (d / Math.max(1, t)) * 3)}%`;
    });
    await progress(0.15, 'Starting renderer…');
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ui = document.getElementById('ui-root')!;
    const game = new Game(canvas, ui);
    await progress(0.55, 'Building the world…');
    game.start();
    await progress(1, 'Ready');
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 700);
    (window as unknown as { __game: Game }).__game = game; // handy for debugging & automated tests
  } catch (err) {
    console.error(err);
    fatal('Something went wrong while starting', String((err as Error)?.message ?? err));
  }
}

void boot();
