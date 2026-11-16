import {
  ConsoleNotifier,
  ExternalPayment,
  LocalStore,
  LoggingDecorator,
  NotificationBus,
  PaymentFactory,
  TransferService,
  WalletPayment,
} from "./domain.js";
export const store = new LocalStore();
export const transfers = new TransferService(
  store,
  new PaymentFactory([
    new LoggingDecorator(new WalletPayment(store)),
    new ExternalPayment("BANK"),
    new ExternalPayment("CARD"),
  ]),
  new NotificationBus([new ConsoleNotifier()]),
);
