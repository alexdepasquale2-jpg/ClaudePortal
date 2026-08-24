import { GameBootstrap } from '@core/bootstrap/GameBootstrap';
import { qualityTierById } from '@core/data/settings/QualityTiers';
import { RenderContext } from '@render/RenderContext';
import { SiteSceneBuilder } from '@render/SiteSceneBuilder';
import { BootScene } from '@scenes/BootScene';

/**
 * Application entry point.
 *
 * The only module allowed to import both `core` and `scenes` — see the `app` layer rule in
 * eslint.config.js. Everything it does is wiring; no game logic lives here.
 *
 * Today it boots as far as the design is actually built: BootScene validates every data contract
 * (which is the cheapest smoke test in the codebase — if it completes, every schema agrees with
 * every data file), then puts a lit placeholder site on screen so the renderer, the clock and the
 * resize path are all genuinely exercised. Beyond that the scenes are scaffolding and say so.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
    throw new Error('index.html is missing #viewport or #overlay');
  }

  const bootstrap = new GameBootstrap({ canvas, overlay, entryScene: 'Boot' });
  bootstrap.registerServices();

  bootstrap.registerScenes({
    Boot: () =>
      new BootScene(() => {
        // Data contracts are valid by this point. Bring the renderer up.
        const quality = qualityTierById(bootstrap.capabilities.suggestedQuality);
        const render = new RenderContext(canvas, quality);
        render.observeResize();

        const site = new SiteSceneBuilder(quality).buildPlaceholder();
        render.scene.add(site.root);
        render.camera.position.set(0, 22, 24);
        render.camera.lookAt(0, 0, 0);

        bootstrap.clock.addRenderer(render);
        renderStatus(overlay, bootstrap.capabilities.suggestedQuality);
      }),
  });

  await bootstrap.start();
}

/** Honest placeholder: says what is built and what is not, rather than pretending to be a game. */
function renderStatus(overlay: HTMLElement, quality: string): void {
  overlay.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'boot-status';
  panel.innerHTML = `
    <h1>SkyNeet Survivors</h1>
    <p class="tagline">Every run changes the battlefield for the next run.</p>
    <p class="status">Scaffolding build — data contracts validated, renderer live.</p>
    <p class="detail">Quality tier: ${quality}. See docs/SCOPE-LEDGER.md for the next vertical slice.</p>
  `;
  overlay.appendChild(panel);
}

main().catch((error: unknown) => {
  console.error(error);
  const overlay = document.getElementById('overlay');
  if (overlay) {
    const message = error instanceof Error ? error.message : String(error);
    overlay.replaceChildren();
    const failure = document.createElement('pre');
    failure.className = 'boot-error';
    failure.textContent = `SkyNeet failed to start:\n\n${message}`;
    overlay.appendChild(failure);
  }
});
