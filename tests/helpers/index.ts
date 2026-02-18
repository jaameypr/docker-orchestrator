/**
 * Test helpers index - re-exports all test utilities.
 *
 * Usage in tests:
 *   import { createMockDockerClient, generateStatsFixture } from "../helpers/index.js";
 */

// Mock Docker client and resources
export {
  createMockDockerClient,
  createMockContainer,
  createMockNetwork,
  createMockVolume,
  createMockExec,
} from "./mock-docker-client.js";
export type {
  MockDockerClient,
  MockContainer,
  MockNetwork,
  MockVolume,
  MockExec,
  MockContainerOptions,
} from "./mock-docker-client.js";

// Mock stream utilities
export {
  createMockReadableStream,
  createMockWritableStream,
  createMultiplexedFrame,
  createMultiplexedStream,
  createMockLogStream,
  createMockJsonStream,
  createErrorStream,
  collectStreamData,
  waitForStreamEvents,
} from "./mock-streams.js";

// Fixture generators
export {
  generateStatsFixture,
  generateHighCpuStatsFixture,
  generateHighMemoryStatsFixture,
  generateInitialStatsFixture,
  generateCgroupV2StatsFixture,
  generateInspectFixture,
  generateEventFixture,
  generateNetworkInspectFixture,
  generateVolumeInspectFixture,
  generateImageInspectFixture,
  generateExecInspectFixture,
} from "./fixtures.js";
export type { InspectOverrides, EventOverrides } from "./fixtures.js";

// Integration test helpers
export {
  isDockerAvailable,
  TEST_IMAGE,
  TEST_PREFIX,
  TEST_LABEL,
  createTestDocker,
  cleanupContainers,
  cleanupNetworks,
  cleanupVolumes,
  cleanupAll,
  withTestContainer,
  withTimeout,
} from "./integration.js";
