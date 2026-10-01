import "../globals.css"
import { Fragment } from "react/jsx-runtime";
import { AccentColorSync } from "@/components/providers/accent-color-sync";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Fragment>
      <AccentColorSync />
      {children}
    </Fragment>
  );
}
