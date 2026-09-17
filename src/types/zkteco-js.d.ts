// zkteco-js ships no types. It sets `module.exports` to a constructor — which
// is why `Object.keys(require("zkteco-js"))` is empty; functions have no
// enumerable own keys — so a default import is the correct shape.
//
// Only what this codebase actually calls is declared. Writing out the whole
// surface would be inventing a contract nobody has checked: everything here
// has been called against a real device and its answer recorded.

declare module "zkteco-js" {
  /** One read of a finger, as the device reports it. */
  export type ZKAttendance = {
    sn: number;
    /** The device's own user number, as a string. */
    user_id: string;
    /** Parsed by the library into a Date in the machine's local zone. */
    record_time: string | Date;
    type: number;
    state: number;
    ip: string;
  };

  export type ZKUser = {
    uid: number;
    /** 14 is the device's administrator. */
    role: number;
    password: string;
    name: string;
    cardno: number;
    /** The number the attendance logs refer to. */
    userId: string;
  };

  export type ZKInfo = {
    userCounts: number;
    logCounts: number;
    logCapacity: number;
  };

  export default class ZKLib {
    constructor(ip: string, port: number, timeout: number, inport: number);

    createSocket(): Promise<void>;
    disconnect(): Promise<void>;

    getInfo(): Promise<ZKInfo>;
    /** Either a bare array or `{ data: [...] }`, depending on the transport it chose. */
    getUsers(): Promise<ZKUser[] | { data: ZKUser[] }>;
    getAttendances(): Promise<ZKAttendance[] | { data: ZKAttendance[] }>;

    getTime(): Promise<Date | string>;
    setTime(at: Date): Promise<unknown>;

    /**
     * The machine stops serving while it is disabled, so these always come in a
     * pair with the write between them — leaving it disabled would stop people
     * clocking in. The ZK protocol wants this around a write to the clock.
     */
    disableDevice(): Promise<unknown>;
    enableDevice(): Promise<unknown>;

    /**
     * Two different numbers, and the order matters: `uid` is the device's
     * internal slot, `userid` is what the attendance log refers to and what an
     * employee is paired with. Writing to a `userid` somebody already has
     * replaces that person.
     */
    setUser(
      uid: number,
      userid: string,
      name: string,
      password: string,
      role?: number,
      cardno?: number
    ): Promise<unknown>;

    /** By the internal slot, **not** the userid — they differ, and this deletes. */
    deleteUser(uid: number): Promise<unknown>;

    /** Wipes every punch the device holds. Irreversible. */
    clearAttendanceLog(): Promise<unknown>;
  }
}
