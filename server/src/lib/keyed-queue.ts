/**
 * Runs tasks one at a time per key (e.g. per chat) while different keys run in
 * parallel. Keeps a customer's messages — and the bot's replies — in order when
 * they send several in quick succession.
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  constructor(private onError: (err: unknown, key: string) => void = () => {}) {}

  push(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((err) => this.onError(err, key))
      .finally(() => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      });
    this.tails.set(key, next);
    return next;
  }

  /** Resolves once every queued task has finished (used by tests and on shutdown). */
  async drain(): Promise<void> {
    while (this.tails.size) await Promise.all(this.tails.values());
  }
}
