export {
  WorkspaceMode,
  WorkspaceStatus,
  WorkspaceSnapshot,
  WorkspacePreparationInput,
  WorkspacePreparationResult,
} from "../../core/programming-contracts";

export interface WorkspaceCommitRequest {
  workspaceId: string;
  message: string;
  paths?: string[];
}
