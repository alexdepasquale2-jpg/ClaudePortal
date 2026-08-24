import type { Scene } from '@core/bootstrap/SceneRouter';
import { loadBiomes } from '@core/data/biomes/BiomeDefinition';
import { loadCardPool } from '@core/data/cards/InRunCard';
import { loadGoliathCatalog } from '@core/data/factions/GoliathCatalog';
import { loadNobotGroupTemplates } from '@core/data/factions/NobotGroupTemplate';
import { loadSancientPowerTiers } from '@core/data/factions/SancientDefinition';
import { loadVerbToTagMapping } from '@core/data/flavor/FlavorTagDefinition';
import { loadMaterials } from '@core/data/materials/MaterialDefinition';
import { loadInfluenceVolumeSettings } from '@core/data/campaign/InfluenceVolumeSettings';
import { loadGameSettings } from '@core/data/settings/GameSettings';
import { loadQualityTiers } from '@core/data/settings/QualityTiers';
import { loadCameraPresets } from '@core/data/tech/CameraPresets';
import { loadFeatTracks } from '@core/data/tech/FeatDefinition';
import { loadTechTree } from '@core/data/tech/TechTree';
import { loadStrings } from '@core/data/localization/StringTable';

/**
 * First scene. Validates every data contract, then hands off to the main menu.
 *
 * Loading everything here is deliberate: DATA-CONTRACTS.md promises that bad data fails loudly with
 * the offending field named. That promise is only kept if every file is parsed at startup rather
 * than lazily, the first time some system happens to need it — which might be forty minutes into a
 * run, at the worst possible moment.
 *
 * This is also the cheapest smoke test in the codebase. If Boot completes, every schema in the game
 * agrees with every data file.
 */
export class BootScene implements Scene {
  readonly name = 'Boot';

  constructor(private readonly onReady: () => Promise<void> | void) {}

  async load(): Promise<void> {
    // Order does not matter; failing fast on any one of them does.
    loadMaterials();
    loadBiomes();
    loadGoliathCatalog();
    loadSancientPowerTiers();
    loadNobotGroupTemplates();
    loadCardPool();
    loadTechTree();
    loadFeatTracks();
    loadCameraPresets();
    loadVerbToTagMapping();
    loadInfluenceVolumeSettings();
    loadGameSettings();
    loadQualityTiers();
    loadStrings();

    await this.onReady();
  }

  unload(): void {
    // Nothing to tear down; the loaders cache and the caches are process-lifetime.
  }
}
