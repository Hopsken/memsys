import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router";

import { authClient } from "@/shared/api";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export const AccountView = () => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <section aria-label="Account">
      <Card className="flex-row items-center justify-between gap-4 px-4">
        <p className="min-w-0 truncate text-base font-medium">
          {session.data?.user.email}
        </p>
        <Button
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            await navigate("/login", { replace: true });
          }}
          size="sm"
          variant="outline"
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </Card>
    </section>
  );
};
