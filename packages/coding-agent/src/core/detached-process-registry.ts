/**
 * Detached process registry — per-fork process tracking with output streaming.
 * On worker kill, killAll(forkId) terminates all processes for that fork.
 */

export interface DetachedProcessEntry {
	pid: number;
	forkId: string;
	startedAt: number;
	outputPath?: string;
}

export class DetachedProcessRegistry {
	private readonly processes = new Map<number, DetachedProcessEntry>();
	private readonly byFork = new Map<string, Set<number>>();

	register(pid: number, forkId: string, options?: { outputPath?: string }): void {
		const entry: DetachedProcessEntry = {
			pid,
			forkId,
			startedAt: Date.now(),
			outputPath: options?.outputPath,
		};
		this.processes.set(pid, entry);
		let forkSet = this.byFork.get(forkId);
		if (!forkSet) {
			forkSet = new Set();
			this.byFork.set(forkId, forkSet);
		}
		forkSet.add(pid);
	}

	unregister(pid: number): void {
		const entry = this.processes.get(pid);
		if (!entry) return;
		this.processes.delete(pid);
		this.byFork.get(entry.forkId)?.delete(pid);
	}

	killAll(forkId: string): void {
		const pids = this.byFork.get(forkId);
		if (!pids) return;
		for (const pid of pids) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Process may have already exited
			}
			this.processes.delete(pid);
		}
		this.byFork.delete(forkId);
	}

	getProcessesForFork(forkId: string): DetachedProcessEntry[] {
		const pids = this.byFork.get(forkId);
		if (!pids) return [];
		return [...pids].map((pid) => this.processes.get(pid)).filter((e): e is DetachedProcessEntry => e !== undefined);
	}

	dispose(): void {
		for (const [forkId] of this.byFork) {
			this.killAll(forkId);
		}
	}
}
