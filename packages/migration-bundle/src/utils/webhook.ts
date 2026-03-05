/**
 * Webhook Helper for Migration Events
 *
 * Sends HTTP POST requests to a configured webhook URL at key migration points.
 * Enables users to build their own logging, monitoring, or notification solutions.
 *
 * Configuration:
 *   MIGRATION_BUNDLE_WEBHOOK_URL - The URL to send webhook events to (optional)
 */

export interface MigrationWebhookPayload {
	event_type: string;
	session_id: string;
	timestamp: string;
	source_url: string;
	target_url: string;
	user_email?: string;
	dry_run: boolean;
	scope?: Record<string, unknown>;
	step_summary?: {
		created?: number;
		updated?: number;
		failed?: number;
		duration_ms?: number;
		collections?: number;
		fields?: number;
		relations?: number;
		folders?: number;
		files?: number;
		roles?: number;
		users?: number;
		policies?: number;
	};
	summary?: {
		schema?: { collections: number; fields: number; relations: number };
		content?: { created: number; updated: number; failed: number };
		files?: { folders: number; files: number };
		users?: { roles: number; users: number; policies: number };
		duration_ms: number;
	};
	error?: {
		message: string;
		details?: Record<string, unknown>;
	};
}

/**
 * Generate a unique session ID for correlating all events in a migration run
 */
export function generateSessionId(): string {
	return `mig_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Send a webhook event to the configured URL
 *
 * @param payload - The event data to send
 * @returns Promise that resolves when the request completes (or immediately if no URL configured)
 *
 * Note: Errors are caught and logged silently - webhook failures should never break migrations
 */
export async function sendWebhook(payload: MigrationWebhookPayload): Promise<void> {
	const url = process.env['MIGRATION_BUNDLE_WEBHOOK_URL'];
	if (!url) return;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'Directus-Migration-Bundle/1.0',
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			console.error(`[Migration Webhook] HTTP ${response.status}: ${response.statusText}`);
		}
	} catch (error) {
		// Silent fail - don't break migration for webhook errors
		console.error('[Migration Webhook] Failed to send:', error instanceof Error ? error.message : error);
	}
}

/**
 * Create a webhook context for a migration session
 *
 * This helper creates a bound context with session details,
 * making it easier to send events throughout a migration.
 */
export function createWebhookContext(params: {
	sessionId: string;
	sourceUrl: string;
	targetUrl: string;
	userEmail?: string;
	dryRun: boolean;
	scope?: Record<string, unknown>;
}) {
	const { sessionId, sourceUrl, targetUrl, userEmail, dryRun, scope } = params;

	return {
		sessionId,

		/**
		 * Send a migration event
		 */
		async send(
			eventType: string,
			extra?: Partial<Pick<MigrationWebhookPayload, 'step_summary' | 'summary' | 'error'>>
		): Promise<void> {
			await sendWebhook({
				event_type: eventType,
				session_id: sessionId,
				timestamp: new Date().toISOString(),
				source_url: sourceUrl,
				target_url: targetUrl,
				user_email: userEmail,
				dry_run: dryRun,
				scope,
				...extra,
			});
		},

		/**
		 * Send a step start event
		 */
		async stepStart(step: string): Promise<void> {
			await this.send(`${step}:start`);
		},

		/**
		 * Send a step complete event with summary
		 */
		async stepComplete(step: string, stepSummary?: MigrationWebhookPayload['step_summary']): Promise<void> {
			await this.send(`${step}:complete`, { step_summary: stepSummary });
		},

		/**
		 * Send a step error event
		 */
		async stepError(step: string, error: Error | string): Promise<void> {
			await this.send(`${step}:error`, {
				error: {
					message: error instanceof Error ? error.message : error,
					details: error instanceof Error ? { stack: error.stack } : undefined,
				},
			});
		},
	};
}
