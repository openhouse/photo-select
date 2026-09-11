// Decode the request at the external API boundary; fixtures do not generate the
// production prompt or infer voices from private metadata outside the request.
export const requestInstructions = request => request.instructions ?? request.input
  .filter(message => message.role === 'developer')
  .flatMap(message => message.content.map(part => part.text)).join('');
export function githubRequestData(request) {
  const instructions = requestInstructions(request);
  const labels = request.input.at(-1).content.filter(part => part.type === 'input_text')
    .slice(1).map(part => JSON.parse(part.text));
  const minutes = request.text.format.schema.properties.minutes;
  const curators = minutes.items.properties.speaker.enum ??
    instructions.match(/^- Curators: (.+)$/m)?.[1].split(', ');
  return {filenames: labels.map(label => label.filename), curators, labels,
    minutesMin: minutes.minItems ?? Number(instructions.match(/Produce between (\d+) and/)[1])};
}
