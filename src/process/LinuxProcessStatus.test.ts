import { expect, it } from "vitest";

import {
  linuxEnvironmentRestriction,
  linuxUserNamespaceRestriction,
  parseLinuxProcessIds,
} from "./LinuxProcessStatus.js";

it("parses the single native status Uid and Gid rows", () => {
  const status =
    "Name:\tworker\nUid:\t1000\t1001\t1002\t1003\nGid:\t20\t21\t22\t23\n";
  expect(parseLinuxProcessIds(status, "Uid")).toEqual([1000, 1001, 1002, 1003]);
  expect(parseLinuxProcessIds(status, "Gid")).toEqual([20, 21, 22, 23]);
});

it.each([
  "Name:\tworker\n",
  "Uid:\t1000\t1001\t1002\n",
  "Uid:\t1000\t1001\t1002\t1003\nUid:\t1000\t1001\t1002\t1003\n",
  "Uid:\t1000\t-1\t1002\t1003\n",
  "Uid:\t1000\t9007199254740992\t1002\t1003\n",
  "Uid:\t1000\t1001\t1002\t1003 extra\n",
])("does not infer IDs from malformed status: %s", (status) => {
  expect(parseLinuxProcessIds(status, "Uid")).toBeUndefined();
});

const caller = { callerUid: 1000, callerGid: 1000 } as const;
const matching = [1000, 1000, 1000, 1000] as const;

it.each([
  [
    "a setgid program",
    { uids: matching, gids: [1000, 2, 2, 2], procfsOwnerUid: 1000 },
    "credentials",
  ],
  [
    "a saved UID from another account",
    { uids: [1000, 1000, 0, 1000], gids: matching, procfsOwnerUid: 1000 },
    "credentials",
  ],
  [
    "a non-dumpable process",
    { uids: matching, gids: matching, procfsOwnerUid: 0 },
    "non-dumpable",
  ],
  [
    "an inspectable process",
    { uids: matching, gids: matching, procfsOwnerUid: 1000 },
    undefined,
  ],
  [
    "a process with unknown procfs ownership and GIDs",
    { uids: matching, gids: undefined, procfsOwnerUid: undefined },
    undefined,
  ],
] as const)(
  "derives the kernel environment restriction for %s",
  (_name, facts, expected) => {
    expect(linuxEnvironmentRestriction({ ...caller, ...facts })).toBe(expected);
  },
);

it.each([
  [
    "a different user namespace",
    { state: "readable", id: "user:[1]" },
    { state: "readable", id: "user:[2]" },
    "user-namespace",
  ],
  [
    "a namespace link the kernel withholds",
    { state: "readable", id: "user:[1]" },
    { state: "withheld" },
    "user-namespace",
  ],
  [
    "the caller's own namespace",
    { state: "readable", id: "user:[1]" },
    { state: "readable", id: "user:[1]" },
    undefined,
  ],
  [
    "a namespace link that cannot be compared",
    { state: "readable", id: "user:[1]" },
    { state: "unknown" },
    undefined,
  ],
  [
    "an unreadable caller namespace",
    { state: "unknown" },
    { state: "readable", id: "user:[2]" },
    undefined,
  ],
] as const)(
  "derives a user-namespace restriction for %s",
  (_name, callerNamespace, targetNamespace, expected) => {
    expect(
      linuxUserNamespaceRestriction(callerNamespace, targetNamespace),
    ).toBe(expected);
  },
);

it("does not derive a credential restriction without caller credentials", () => {
  expect(
    linuxEnvironmentRestriction({
      uids: [0, 0, 0, 0],
      gids: [0, 0, 0, 0],
      procfsOwnerUid: 0,
      callerUid: undefined,
      callerGid: undefined,
    }),
  ).toBeUndefined();
});
