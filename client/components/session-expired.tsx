import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const SessionExpired = () => (
  <Card className="items-center p-8" role="alert">
    <h2 className="font-medium">Your session has expired</h2>
    <Button onClick={() => window.location.reload()}>Sign in again</Button>
  </Card>
);
