import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuestionImage } from "@/components/content/question-image";

import { apiError, findToast, json, mockApi, question, renderPanel } from "./content-helpers";

const file = () => new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", { type: "image/png" });

describe("QuestionImage", () => {
  it("uploads the file as multipart field `image` with CSRF, and previews the server's copy", async () => {
    const { calls, spy } = mockApi(() => json(200, question({ image: "http://localhost/media/questions/abc.png" })));
    const onChange = vi.fn();
    renderPanel(<QuestionImage question={question()} onChange={onChange} />);
    expect(screen.getByText("No image yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/questions/100/image/" });
    const body = calls[0].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get("image") as File).name).toBe("diagram.png");
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-CSRFToken"]).toBe("test-token");
    expect(headers["Content-Type"]).toBeUndefined(); // the browser sets the multipart boundary
    expect(await findToast()).toHaveTextContent("Image uploaded.");
  });

  it("shows the server's validation message for a bad file", async () => {
    mockApi(() => apiError(400, "validation_error", "x", { image: ["Upload a valid JPEG, PNG or WebP image."] }));
    renderPanel(<QuestionImage question={question()} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file()] } });
    expect(await screen.findByText("Upload a valid JPEG, PNG or WebP image.")).toBeInTheDocument();
  });

  it("previews an existing image, replaces it and removes it after confirmation", async () => {
    const { calls } = mockApi(({ method }) => json(200, question({ image: method === "DELETE" ? null : "/media/new.png" })));
    const onChange = vi.fn();
    renderPanel(<QuestionImage question={question({ image: "/media/old.png" })} onChange={onChange} />);
    expect(screen.getByRole("img", { name: "Image for question #100" })).toHaveAttribute("src", "/media/old.png");
    expect(screen.getByRole("button", { name: "Replace image" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove the image?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove image" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ image: null })));
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/v1/admin/questions/100/image/" });
  });

  it("explains question_locked on upload", async () => {
    mockApi(() => apiError(409, "question_locked", "Locked."));
    renderPanel(<QuestionImage question={question()} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file()] } });
    expect(await screen.findByText("This question is used by a published exam and cannot be edited.")).toBeInTheDocument();
  });
});
