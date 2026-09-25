import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth";

export const SessionExpired = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Card className="items-center p-8" role="alert">
      <h2 className="font-medium">Your session has expired</h2>
      <Button
        onClick={async () => {
          await authClient.signOut();
          queryClient.clear();
          await navigate("/login");
        }}
      >
        Sign in again
      </Button>
    </Card>
  );
};
