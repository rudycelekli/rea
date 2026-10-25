/** Real, effective, saved and filesystem IDs from one Linux status row. */
export type LinuxProcessIds = readonly [number, number, number, number];

/** Parse the single `Uid:` or `Gid:` row of one Linux `/proc/<pid>/status` record. */
export const parseLinuxProcessIds = (
  value: string,
  row: "Uid" | "Gid",
): LinuxProcessIds | undefined => {
  let ids: LinuxProcessIds | undefined;
  for (const line of value.split("\n")) {
    if (!line.startsWith(`${row}:`)) continue;
    if (ids !== undefined) return undefined;
    const match =
      /^[UG]id:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/u.exec(line);
    if (match === null) return undefined;
    const [real, effective, saved, filesystem] = match.slice(1).map(Number);
    if (
      real === undefined ||
      effective === undefined ||
      saved === undefined ||
      filesystem === undefined ||
      [real, effective, saved, filesystem].some(
        (id) => !Number.isSafeInteger(id) || id < 0,
      )
    )
      return undefined;
    ids = [real, effective, saved, filesystem];
  }
  return ids;
};

/**
 * Why Linux withholds `/proc/<pid>/environ` from a caller without
 * CAP_SYS_PTRACE (PTRACE_MODE_READ_FSCREDS): the target's real, effective or
 * saved UID/GID differs from the caller's, the target is non-dumpable, which
 * procfs reports as root ownership of `/proc/<pid>/environ`, or the target
 * lives in a different user namespace, which denies `environ` with `EACCES`
 * even when the numeric credentials match.
 */
export type LinuxEnvironmentRestriction =
  | "credentials"
  | "non-dumpable"
  | "user-namespace";

/** Derive the kernel's environment restriction from one generation's procfs facts. */
export const linuxEnvironmentRestriction = (facts: {
  readonly uids: LinuxProcessIds;
  readonly gids: LinuxProcessIds | undefined;
  readonly procfsOwnerUid: number | undefined;
  readonly callerUid: number | undefined;
  readonly callerGid: number | undefined;
}): LinuxEnvironmentRestriction | undefined => {
  const { uids, gids, procfsOwnerUid, callerUid, callerGid } = facts;
  if (
    (callerUid !== undefined &&
      uids.slice(0, 3).some((uid) => uid !== callerUid)) ||
    (callerGid !== undefined &&
      gids !== undefined &&
      gids.slice(0, 3).some((gid) => gid !== callerGid))
  )
    return "credentials";
  return procfsOwnerUid !== undefined && procfsOwnerUid !== uids[1]
    ? "non-dumpable"
    : undefined;
};

/** One `/proc/<pid>/ns/user` observation. A missing link is not a foreign namespace. */
export type LinuxUserNamespaceObservation =
  | { readonly state: "readable"; readonly id: string }
  | { readonly state: "withheld" }
  | { readonly state: "unknown" };

/**
 * A different user namespace withholds `environ` across the namespace boundary
 * even when the numeric uid and gid match. An unreadable namespace link is the
 * same boundary. An unknown or identical link is not evidence.
 */
export const linuxUserNamespaceRestriction = (
  caller: LinuxUserNamespaceObservation,
  target: LinuxUserNamespaceObservation,
): LinuxEnvironmentRestriction | undefined => {
  if (caller.state !== "readable") return undefined;
  if (target.state === "withheld") return "user-namespace";
  if (target.state === "readable" && target.id !== caller.id)
    return "user-namespace";
  return undefined;
};
