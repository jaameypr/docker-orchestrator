import { describe, it, expect } from "vitest";
import { resolveDependencyOrder } from "../../src/core/stack.js";
import { StackConfigSchema } from "../../src/types/stack.js";
import { DependencyResolutionError } from "../../src/errors/base.js";

describe("resolveDependencyOrder", () => {
  it("should return correct order for simple dependencies", () => {
    const order = resolveDependencyOrder({
      web: { dependsOn: ["db", "redis"] },
      db: {},
      redis: {},
    });

    const webIdx = order.indexOf("web");
    const dbIdx = order.indexOf("db");
    const redisIdx = order.indexOf("redis");

    expect(webIdx).toBeGreaterThan(dbIdx);
    expect(webIdx).toBeGreaterThan(redisIdx);
  });

  it("should handle chain dependencies", () => {
    const order = resolveDependencyOrder({
      app: { dependsOn: ["api"] },
      api: { dependsOn: ["db"] },
      db: {},
    });

    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("app"));
  });

  it("should handle services with no dependencies", () => {
    const order = resolveDependencyOrder({
      a: {},
      b: {},
      c: {},
    });

    expect(order).toHaveLength(3);
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order).toContain("c");
  });

  it("should throw DependencyResolutionError for circular dependencies", () => {
    expect(() =>
      resolveDependencyOrder({
        a: { dependsOn: ["b"] },
        b: { dependsOn: ["c"] },
        c: { dependsOn: ["a"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should throw for self-referencing dependency", () => {
    expect(() =>
      resolveDependencyOrder({
        a: { dependsOn: ["a"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should throw when dependsOn references unknown service", () => {
    expect(() =>
      resolveDependencyOrder({
        web: { dependsOn: ["nonexistent"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should handle complex dependency graph", () => {
    const order = resolveDependencyOrder({
      frontend: { dependsOn: ["api", "cdn"] },
      api: { dependsOn: ["db", "cache"] },
      db: {},
      cache: {},
      cdn: {},
      worker: { dependsOn: ["db", "cache"] },
    });

    expect(order).toHaveLength(6);
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("frontend"));
    expect(order.indexOf("cdn")).toBeLessThan(order.indexOf("frontend"));
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("worker"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("worker"));
  });
});

describe("StackConfigSchema", () => {
  it("should validate minimal stack config", () => {
    const result = StackConfigSchema.parse({
      name: "my-stack",
      containers: {
        web: { image: "nginx:1.25" },
      },
    });

    expect(result.name).toBe("my-stack");
    expect(result.containers.web).toBeDefined();
  });

  it("should validate full stack config with networks and volumes", () => {
    const result = StackConfigSchema.parse({
      name: "full-stack",
      containers: {
        db: {
          image: "postgres:16",
          env: { POSTGRES_PASSWORD: "secret" },
        },
        web: {
          image: "nginx:1.25",
          dependsOn: ["db"],
          scale: 2,
          ports: [{ container: 80, host: 8080 }],
        },
      },
      networks: {
        backend: {
          driver: "bridge",
          internal: true,
        },
      },
      volumes: {
        pgdata: {
          driver: "local",
        },
      },
    });

    expect(result.containers.web.dependsOn).toEqual(["db"]);
    expect(result.containers.web.scale).toBe(2);
    expect(result.networks!.backend.internal).toBe(true);
    expect(result.volumes!.pgdata.driver).toBe("local");
  });

  it("should apply default scale of 1", () => {
    const result = StackConfigSchema.parse({
      name: "test",
      containers: { web: { image: "nginx:1.25" } },
    });
    expect(result.containers.web.scale).toBe(1);
  });

  it("should reject empty stack name", () => {
    expect(() =>
      StackConfigSchema.parse({
        name: "",
        containers: { web: { image: "nginx" } },
      }),
    ).toThrow();
  });
});
