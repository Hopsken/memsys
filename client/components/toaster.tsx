import { Toast } from "@base-ui/react/toast";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";

// One manager for the whole app, so a toast can outlive the view that raised
// it, such as a dialog that closes as it confirms.
export const toasts = Toast.createToastManager();

const ToastList = () => {
  const { toasts: items } = Toast.useToastManager();
  return items.map((toast) => (
    <Toast.Root
      className="bg-popover text-popover-foreground ring-foreground/10 flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-4 text-sm shadow-lg ring-1 transition-[opacity,translate] duration-200 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
      key={toast.id}
      toast={toast}
    >
      <Toast.Title className="flex-1" />
      <Toast.Action
        className={buttonVariants({ size: "sm", variant: "ghost" })}
      />
      <Toast.Close
        aria-label="Close"
        className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
      >
        <XIcon aria-hidden="true" />
      </Toast.Close>
    </Toast.Root>
  ));
};

export const Toaster = ({ children }: { children: ReactNode }) => (
  <Toast.Provider toastManager={toasts}>
    {children}
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
