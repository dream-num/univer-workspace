export type HomeView = "recent" | "owned" | "shared";

export interface HomePageProps {
  readonly view?: HomeView;
}
