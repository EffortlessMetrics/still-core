import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Only upstream template material is licensed here; generated application/content is owner-controlled.
export async function scopeStarterLicense(destination) {
  const notices = join(destination, "licenses/template");
  await mkdir(notices, { recursive: true });
  for (const name of ["LICENSE", "LICENSE-MIT", "LICENSE-APACHE"])
    await rename(join(destination, name), join(notices, name));
  await writeFile(join(notices, "README.md"), "# Upstream template notices\n\nThese unchanged notices apply only to reused upstream template code and original neutral examples, under MIT OR Apache-2.0. This grant does not license your replacement content, photographs, branding or independently authored application code. Choose those terms separately. Fonts and dependencies retain their own notices and terms.\n");
  const path = join(destination, "package.json");
  const application = JSON.parse(await readFile(path, "utf8"));
  application.license = "UNLICENSED";
  await writeFile(path, JSON.stringify(application, null, 2) + "\n");
}
