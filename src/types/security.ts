import { z } from "zod";

// ---------------------------------------------------------------------------
// Linux Capabilities
// ---------------------------------------------------------------------------

/** All known Linux capabilities */
export const LINUX_CAPABILITIES = [
  "AUDIT_CONTROL",
  "AUDIT_READ",
  "AUDIT_WRITE",
  "BLOCK_SUSPEND",
  "BPF",
  "CHECKPOINT_RESTORE",
  "CHOWN",
  "DAC_OVERRIDE",
  "DAC_READ_SEARCH",
  "FOWNER",
  "FSETID",
  "IPC_LOCK",
  "IPC_OWNER",
  "KILL",
  "LEASE",
  "LINUX_IMMUTABLE",
  "MAC_ADMIN",
  "MAC_OVERRIDE",
  "MKNOD",
  "NET_ADMIN",
  "NET_BIND_SERVICE",
  "NET_BROADCAST",
  "NET_RAW",
  "PERFMON",
  "SETFCAP",
  "SETGID",
  "SETPCAP",
  "SETUID",
  "SYS_ADMIN",
  "SYS_BOOT",
  "SYS_CHROOT",
  "SYS_MODULE",
  "SYS_NICE",
  "SYS_PACCT",
  "SYS_PTRACE",
  "SYS_RAWIO",
  "SYS_RESOURCE",
  "SYS_TIME",
  "SYS_TTY_CONFIG",
  "SYSLOG",
  "WAKE_ALARM",
] as const;

export type LinuxCapability = (typeof LINUX_CAPABILITIES)[number];

/** Capabilities considered dangerous that trigger warnings */
export const DANGEROUS_CAPABILITIES: readonly LinuxCapability[] = [
  "SYS_ADMIN",
  "NET_ADMIN",
  "SYS_PTRACE",
  "SYS_MODULE",
  "SYS_RAWIO",
  "DAC_READ_SEARCH",
] as const;

const CapabilitySchema = z.string().transform((val) => val.toUpperCase());

// ---------------------------------------------------------------------------
// Capability Profiles
// ---------------------------------------------------------------------------

export const CapabilityProfileNameSchema = z.enum(["minimal", "web", "default"]);
export type CapabilityProfileName = z.infer<typeof CapabilityProfileNameSchema>;

export interface CapabilityProfile {
  name: CapabilityProfileName;
  description: string;
  drop: string[];
  add: string[];
}

/** Predefined capability profiles */
export const CapabilityProfiles: Record<CapabilityProfileName, CapabilityProfile> = {
  minimal: {
    name: "minimal",
    description: "All capabilities dropped except absolute minimum",
    drop: ["ALL"],
    add: [],
  },
  web: {
    name: "web",
    description: "Capabilities for web servers (NET_BIND_SERVICE)",
    drop: ["ALL"],
    add: ["NET_BIND_SERVICE"],
  },
  default: {
    name: "default",
    description: "Docker default capabilities",
    drop: [],
    add: [],
  },
};

// ---------------------------------------------------------------------------
// Seccomp Configuration
// ---------------------------------------------------------------------------

export const SeccompConfigSchema = z.union([
  z.literal("default"),
  z.literal("unconfined"),
  z.object({
    profilePath: z.string().min(1),
  }),
]);

export type SeccompConfig = z.infer<typeof SeccompConfigSchema>;

// ---------------------------------------------------------------------------
// Security Configuration
// ---------------------------------------------------------------------------

export const SecurityConfigSchema = z.object({
  /** User to run as, e.g. "1000:1000" or "node" */
  user: z.string().optional(),
  /** Additional groups */
  groupAdd: z.array(z.string()).optional(),
  /** Capabilities to drop */
  capDrop: z.array(CapabilitySchema).optional(),
  /** Capabilities to add */
  capAdd: z.array(CapabilitySchema).optional(),
  /** Capability profile name */
  capabilityProfile: CapabilityProfileNameSchema.optional(),
  /** Read-only root filesystem */
  readonlyRootfs: z.boolean().optional(),
  /** Tmpfs mounts for writable paths when using readonlyRootfs */
  tmpfsMounts: z.record(z.string()).optional(),
  /** Auto-add tmpfs mounts for common writable paths when readonlyRootfs is true */
  autoTmpfs: z.boolean().optional(),
  /** Set no-new-privileges flag */
  noNewPrivileges: z.boolean().optional(),
  /** Seccomp profile configuration */
  seccomp: SeccompConfigSchema.optional(),
  /** AppArmor profile name */
  apparmorProfile: z.string().optional(),
  /** SELinux label options */
  selinuxLabel: z.string().optional(),
  /** Privileged mode - full host access (use with caution) */
  privileged: z.boolean().optional(),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ---------------------------------------------------------------------------
// Security Presets
// ---------------------------------------------------------------------------

export const SecurityPresetNameSchema = z.enum(["hardened", "standard", "permissive"]);
export type SecurityPresetName = z.infer<typeof SecurityPresetNameSchema>;

export interface SecurityPreset {
  name: SecurityPresetName;
  description: string;
  config: SecurityConfig;
}

export const SecurityPresets: Record<SecurityPresetName, SecurityPreset> = {
  hardened: {
    name: "hardened",
    description:
      "Maximum security: non-root, read-only FS, all caps dropped, no-new-privileges, default seccomp",
    config: {
      user: "1000:1000",
      readonlyRootfs: true,
      autoTmpfs: true,
      capDrop: ["ALL"],
      capAdd: [],
      noNewPrivileges: true,
      seccomp: "default",
      privileged: false,
    },
  },
  standard: {
    name: "standard",
    description: "Recommended defaults: non-root recommended, Docker default caps, default seccomp",
    config: {
      noNewPrivileges: true,
      seccomp: "default",
      privileged: false,
    },
  },
  permissive: {
    name: "permissive",
    description: "Docker defaults with no additional restrictions (use with caution)",
    config: {},
  },
};
