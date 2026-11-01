import type { Visual } from "./companion";

// Authored public examples. They never represent a learner's private course.
export function diagramSamples(t: (text:string)=>string): Visual[] {
  const quote = "A for loop visits each item in a collection. First choose the collection, then check for another item. If an item remains, run the loop body and repeat the check. If no items remain, continue after the loop. For [2, 4, 6], printing each item produces 2, then 4, then 6.";
  const node = (id:string,label:string,detail:string,role:"concept"|"decision"|"example"|"outcome"="concept",source=quote) => ({id,label:t(label),detail:t(detail),role,source_id:"authored-sample",quote:t(source)});
  const edge = (source:string,target:string,label:string,evidence=quote) => ({source,target,label:t(label),source_id:"authored-sample",quote:t(evidence)});
  const treeQuote="Python collections include lists, tuples, sets, and dictionaries. Lists and tuples are sequences. A list is mutable, while a tuple is immutable. A set contains unique elements. A dictionary maps keys to values.";
  const graphQuote="Distance equals speed multiplied by time: d = v × t. At a speed of 3 metres per second for 4 seconds, the distance is 12 metres. Speed describes distance travelled per unit time. Time describes the duration of travel. Use compatible units when multiplying speed and time.";
  return [
    {kind:"flowchart",title:t("How a for loop works"),summary:t("Follow the arrows from the collection to the decision. The Yes branch repeats; the No branch exits. The example shows the values printed by one complete loop."),nodes:[
      node("start","Choose a collection","Start with a collection of items, such as [2, 4, 6]."),
      node("check","Another item?","Check whether an item remains in the collection.","decision"),
      node("body","Run the loop body","Use the next item and execute the instructions in the loop."),
      node("end","Continue the program","After the last item, continue with the code after the loop.","outcome"),
      node("repeat","Check again","Return to the same decision to look for the next item."),
      node("example","Example: 2, 4, 6","Printing each item in [2, 4, 6] outputs 2, then 4, then 6.","example")
    ],edges:[edge("start","check","Start"),edge("check","body","Yes"),edge("check","end","No"),edge("body","repeat","Next iteration"),edge("repeat","check","Repeat"),edge("body","example","For example")]},
    {kind:"tree",title:t("A family of Python collections"),summary:t("Read from the root down. Sequences branch into lists and tuples; their details show the distinction between mutable and immutable collections."),nodes:[
      node("root","Python collections","Collections hold groups of values.","concept",treeQuote),
      node("seq","Sequences","Lists and tuples belong to this group.","concept",treeQuote),
      node("set","Set","Contains unique elements.","concept",treeQuote),
      node("dict","Dictionary","Maps keys to values.","concept",treeQuote),
      node("list","List","A mutable sequence: its contents can change.","concept",treeQuote),
      node("tuple","Tuple","An immutable sequence: its contents cannot be changed in place.","concept",treeQuote)
    ],edges:[edge("root","seq","Includes",treeQuote),edge("root","set","Includes",treeQuote),edge("root","dict","Includes",treeQuote),edge("seq","list","Mutable",treeQuote),edge("seq","tuple","Immutable",treeQuote)]},
    {kind:"graph",title:t("Connect speed, time, and distance"),summary:t("Two inputs meet at multiplication. Follow their arrows to see how the formula produces distance, then open the example for the calculation."),nodes:[
      node("speed","Speed · v","Distance travelled per unit time.","concept",graphQuote),
      node("time","Time · t","The duration of travel.","concept",graphQuote),
      node("multiply","Multiply the inputs","Use d = v × t with compatible units.","concept",graphQuote),
      node("distance","Distance · d","How far an object travels.","outcome",graphQuote),
      node("units","Compatible units","Metres per second multiplied by seconds gives metres.","concept",graphQuote),
      node("example","Worked example","3 m/s × 4 s = 12 m.","example",graphQuote)
    ],edges:[edge("speed","multiply","Input",graphQuote),edge("time","multiply","Input",graphQuote),edge("multiply","distance","Produces",graphQuote),edge("units","multiply","Check units",graphQuote),edge("distance","example","For example",graphQuote)]}
  ];
}
