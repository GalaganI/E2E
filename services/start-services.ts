import { startServer } from './shared/http';
import { serviceConfig } from './shared/config';
import { createPaymentRouter } from './payment/payment-service';
import { createCalendarRouter } from './calendar/calendar-service';

/**
 * Starts the simulated payment provider/merchant and the mock calendar in one process.
 * Mailpit runs as a separate binary (see scripts/install-mailpit.sh and playwright.config.ts).
 */
async function main(): Promise<void> {
  const servers = await Promise.all([
    startServer('payment', serviceConfig.paymentPort, createPaymentRouter()),
    startServer('calendar', serviceConfig.calendarPort, createCalendarRouter()),
  ]);
  console.log(`payment simulator listening on http://127.0.0.1:${serviceConfig.paymentPort}`);
  console.log(`calendar mock listening on http://127.0.0.1:${serviceConfig.calendarPort}`);

  const shutdown = (): void => {
    for (const server of servers) server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('Failed to start services', error);
  process.exit(1);
});
