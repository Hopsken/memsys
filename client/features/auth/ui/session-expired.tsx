import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { authClient } from "@/shared/api";
import { forgetSkeletons } from "@/shared/lib/skeletons";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

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
          // The remembered list outlines belong to whoever was signed in.
          forgetSkeletons();
          await navigate("/login");
        }}
      >
        Sign in again
      </Button>
    </Card>
  );
};
